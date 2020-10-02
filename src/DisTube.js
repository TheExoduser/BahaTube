const ytdl = require("discord-ytdl-core"),
    ytsr = require("ytsr"),
    ytpl = require("ytpl"),
    {EventEmitter} = require("events"),
    Queue = require("./Queue"),
    Song = require("./Song"),
    formatDuration = require("./duration"),
    Discord = require("discord.js"),
    moment = require("moment"),
    url = require("url"),
    spotify = require("spotify-web-api-node"),
    YouTube = require("simple-youtube-api"),
    SoundCloud = require('soundcloud-downloader'),
    Parallel = require("async-parallel"),
    duration = require("./duration"),
    prism = require("prism-media"),
    sckf = require("soundcloud-key-fetch"),
    SCDL = require("node-scdl");// eslint-disable-line

const toSecond = (string) => {
    let h = 0,
        m = 0,
        s = 0;
    if (string.match(/:/g)) {
        let time = string.split(":");
        if (time.length === 2) {
            m = parseInt(time[0], 10);
            s = parseInt(time[1], 10);
        } else if (time.length === 3) {
            h = parseInt(time[0], 10);
            m = parseInt(time[1], 10);
            s = parseInt(time[2], 10);
        }
    } else s = parseInt(string, 10);
    return h * 60 * 60 + m * 60 + s;
};

const updateSpotifyAccessToken = async () => {
    try {
        let data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
    } catch (err) {
        console.log('Something went wrong while setting the spotify access token', err.message);
    }
}

/**
 * DisTube options.
 * @typedef {object} DisTubeOptions
 * @prop {boolean} [emitNewSongOnly=false] `@1.3.0`. If `true`, {@link DisTube#event:playSong} is not emitted when looping a song or next song is the same as the previous one
 * @prop {number} [highWaterMark=1<<24] `@2.2.0` ytdl's highWaterMark option.
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if channel is empty when finish the current song. (Avoid accident leaving)
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using {@link DisTube#stop()} function.
 * @prop {boolean} [searchSongs=false] Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
 * @prop {string} [youtubeCookie=null] `@2.4.0` Youtube cookie to prevent rate limit (Error 429).
 * @prop {string} [youtubeIdentityToken=null] `@2.4.0`
 */
const DisTubeOptions = {
    highWaterMark: 1 << 24,
    emitNewSongOnly: false,
    leaveOnEmpty: true,
    leaveOnFinish: false,
    leaveOnStop: true,
    searchSongs: false,
    youtubeCookie: null,
    youtubeIdentityToken: null,
    soundcloudClientId: null,
    spotifyClientId: null,
    spotifyClientSecret: null
};

/**
 * Distube audio filters.
 * @typedef {string} Filter
 * @prop {string} 3d `@2.0.0`
 * @prop {string} bassboost `@2.0.0`
 * @prop {string} echo `@2.0.0`
 * @prop {string} flanger `@2.4.0`
 * @prop {string} gate `@2.4.0`
 * @prop {string} haas `@2.4.0`
 * @prop {string} karaoke `@2.0.0`
 * @prop {string} nightcore `@2.0.0`
 * @prop {string} reverse `@2.4.0`
 * @prop {string} vaporwave `@2.0.0`
 */
/*
const ffmpegFilters = {
    "3d": "apulsator=hz=0.125",
    bassboost: 'dynaudnorm=f=150:g=15,equalizer=f=40:width_type=h:width=50:g=10',
    echo: "aecho=0.8:0.9:1000:0.3",
    flanger: 'flanger',
    gate: 'agate',
    haas: 'haas',
    karaoke: "stereotools=mlev=0.1",
    nightcore: "asetrate=48000*1.25,aresample=48000,equalizer=f=40:width_type=h:width=50:g=10",
    reverse: 'areverse',
    vaporwave: "asetrate=48000*0.8,aresample=48000,atempo=1.1",
}
*/
const ffmpegFilters = {
    "3d": "apulsator=hz=0.125",
    '8D': 'apulsator=hz=0.08',
    bassboost: 'dynaudnorm=f=150:g=15,equalizer=f=40:width_type=h:width=50:g=10',
    echo: "aecho=0.8:0.9:1000:0.3",
    flanger: 'flanger',
    gate: 'agate',
    haas: 'haas',
    karaoke: 'stereotools=mlev=0.03',
    mcompand: 'mcompand',
    nightcore: 'aresample=48000,asetrate=48000*1.25',
    normalizer: 'dynaudnorm=f=200',
    phaser: 'aphaser=in_gain=0.4',
    pulsator: 'apulsator=hz=1',
    reverse: 'areverse',
    subboost: 'asubboost',
    surrounding: 'surround',
    treble: 'treble=g=5',
    tremolo: 'tremolo',
    vaporwave: 'aresample=48000,asetrate=48000*0.8',
    vibrato: 'vibrato=f=6.5',
}

const spotifyApi = new spotify();
let soundcloud = null;
let scdl = null;

let youtube = null;

/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
class DisTube extends EventEmitter {
    get version() {
        return require("../package.json").version
    }

    /**
     * `@2.2.4` DisTube's current version.
     * @type {string}
     * @readonly
     */
    static get version() {
        return require("../package.json").version
    }

    /**
     * Create new DisTube.
     * @param {Discord.Client} client Discord.JS client
     * @param {DisTubeOptions} [otp={}] Custom DisTube options
     * @example
     * const Discord = require('discord.js'),
     *     DisTube = require('distube'),
     *     client = new Discord.Client();
     * // Create a new DisTube
     * const distube = new DisTube(client, { searchSongs: true });
     * // client.DisTube = distube // make it access easily
     * client.login("Your Discord Bot Token")
     */
    constructor(client, otp = {}) {
        super();
        if (!client) throw new SyntaxError("Invalid Discord.Client");

        /**
         * Discord.JS client
         * @type {Discord.Client}
         */
        this.client = client;

        /**
         * Collection of guild queues
         * @type {Map<string, Queue>}
         */
        this.guildQueues = new Discord.Collection();

        /**
         * DisTube options
         * @type {DisTubeOptions}
         */
        this.options = DisTubeOptions;
        for (let key in otp)
            this.options[key] = otp[key];

        this.requestOptions = this.options.youtubeCookie ? {
            headers: {
                cookie: this.options.youtubeCookie,
                'x-youtube-identity-token': this.options.youtubeIdentityToken
            }
        } : null;

        if (this.options.leaveOnEmpty) client.on("voiceStateUpdate", (oldState) => {
            if (!oldState || !oldState.channel) return;
            let queue = this.guildQueues.find((gQueue) => gQueue.connection && gQueue.connection.channel.id == oldState.channelID);
            if (queue && this._isVoiceChannelEmpty(queue)) {
                setTimeout((queue) => {
                    let guildID = queue.connection.channel.guild.id;
                    if (this.guildQueues.has(guildID) && this._isVoiceChannelEmpty(queue)) {
                        queue.connection.channel.leave();
                        this.emit("empty", queue.initMessage);
                        this.guildQueues.delete(guildID);
                    }
                }, 60000, queue)
            }
        })

        youtube = new YouTube(DisTubeOptions.youtubeIdentityToken);

        soundcloud = new SCDL(DisTubeOptions.soundcloudClientId || sckf.fetchKey());

        spotifyApi.setClientId(DisTubeOptions.spotifyClientId);
        spotifyApi.setClientSecret(DisTubeOptions.spotifyClientSecret);

        // Request Spotify Access Token
        updateSpotifyAccessToken();
    }

    /**
     * Get a list of all supported filters
     * @returns {Array}
     */
    getSupportedFilters() {
        return Object.keys(ffmpegFilters);
    }

    /**
     * Resolve a Song
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|Song)} song Youtube url | Search string | {@link Distube#Song}
     * @private
     * @ignore
     * @returns {Promise<Song>} Resolved Song
     */
    async _resolveSong(message, song, type = "yt") {
        if (typeof song === "object" && type !== "soundcloud_track") {
            song.user = message.author;
            return song;
        } else if (type === "soundcloud_track") {
            return {
                user: message.author,
                id: song.id,
                name: song.res.title,
                duration: (song.res.duration / 1000),
                formattedDuration: duration(song.res.duration),
                url: song.res.permalink_url,
                thumbnail: song.res.artwork_url,
                related: null,
                start_time: null,
                type: "soundcloud_track"
            }

            return this._searchSong(message, `${song.res.title} ${song.res.user.username}`, true, 1, "soundcloud_track", song.res.artwork_url);
        } else if (type === "spotify_track") {
            await updateSpotifyAccessToken();
            
            let s = (await spotifyApi.getTrack(song)).body;
            return this._searchSong(message, `${s.name} ${s.artists[0].name}`, true, 1);
        } else if (!ytdl.validateURL(song))
            return this._searchSong(message, song, true, 1);
        else {
            let info = await ytdl.getBasicInfo(song, {requestOptions: this.requestOptions});
            return new Song(info, message.author);
        }
    }

    async _handleSong(message, song, skip = false) {
        if (!song) return;
        if (this.isPlaying(message)) {
            let queue = this._addToQueue(message, song, skip);
            if (skip) this.skip(message);
            else this.emit("addSong", message, queue, queue.songs[queue.songs.length - 1]);
        } else {
            let queue = await this._newQueue(message, song);
            this.emit("playSong", message, queue, queue.songs[0]);
        }
    }

    async _handleStream(message, stream, skip = false) {
        if (!stream) return;

        if (this.isPlaying(message)) {
            let queue = this._addToQueue(message, stream, skip, true);
            if (skip) this.skip(message);
            else this.emit("addStream", message, queue, queue.songs[queue.songs.length - 1]);
        } else {
            let queue = await this._newQueue(message, song);
            this.emit("playStream", message, queue, queue.songs[0]);
        }
    }

    /**
     * Play / add a song from Youtube video url or playlist from Youtube playlist url. Search and play a song if it is not a valid url.
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|Song)} song Youtube url | Search string | {@link Distube#Song}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "play")
     *         distube.play(message, args.join(" "));
     * });
     */
    async play(message, song) {
        if (!song) return;
        try {
            let sc = await this.parseSoundcloudUrl(song);
            let spot = await this.parseSpotifyUrl(song);

            if (sc !== false && sc.type === "track") {
                await this._handleSong(message, await this._resolveSong(message, sc, "soundcloud_track"));
            } else if (sc !== false && sc.type === "playlist") {
                await this._handlePlaylist(message, song, false, "soundcloud_playlist", sc.id);
            } else if (spot !== false && spot.type === "playlist") {
                await this._handlePlaylist(message, song, false, "spotify_playlist", spot);
            } else if (spot !== false && spot.type === "album") {
                await this._handlePlaylist(message, song, false, "spotify_album", spot);
            } else if (spot !== false && spot.type === "track") {
                await this._handleSong(message, await this._resolveSong(message, spot.id, "spotify_track"));
            } else if (ytpl.validateURL(song)) {
                await this._handlePlaylist(message, song, false, "yt");
            } else {
                await this._handleSong(message, await this._resolveSong(message, song));
            }
        } catch (e) {
            console.error(e);
            this.emit("error", message, e);
        }
    }

    async playStream(message, name, icon, sourceUrl, websiteUrl, tracklistUrl) {
        if (!sourceUrl) return;

        try {
            let song = {
                id: null,
                user: message.author,
                name: name,
                duration: 0,
                formattedDuration: null,
                url: sourceUrl,
                website_url: websiteUrl,
                tracklist_url: tracklistUrl,
                thumbnail: icon,
                related: null,
                start_time: null,
                type: "stream"
            }

            await this._handleSong(message, song, true);
        } catch (e) {
            console.error(e);
            this.emit("error", message, e);
        }
    }

    /**
     * Get current formatted playtime of a song
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|Song)} song Youtube url | Search string | {@link Distube#Song}
     * @returns {string|null}
     */
    getPlayTime(message, song) {
        if (!song) return null;
        return formatDuration((moment().unix() - song.start_time) * 1000);
    }

    /**
     * Parse spotify url
     * @param song Spotify url
     * @returns {Promise<boolean|{id: string, type: string}>}
     */
    async parseSpotifyUrl(song) {
        if (typeof song !== "string") {
            return false;
        }

        if (song.startsWith("spotify:")) {
            let q = song.split(":");
            if (q[1] === "track" || q[1] === "album" || q[1] === "playlist") {
                let erg = null;
                await updateSpotifyAccessToken();

                switch (q[1]) {
                    case "track":
                        erg = (await spotifyApi.getTrack(q[2])).body;
                        break;
                    case "album":
                        erg = (await spotifyApi.getAlbum(q[2])).body;

                        while (erg.tracks.items.length < erg.tracks.total) {
                            let tmp = (await spotifyApi.getPlaylistTracks(q[2], {offset: erg.tracks.items.length})).body;

                            erg.tracks.items = erg.tracks.items.concat(tmp.items);
                        }

                        break;
                    case "playlist":
                        erg = (await spotifyApi.getPlaylist(q[2])).body;

                        while (erg.tracks.items.length < erg.tracks.total) {
                            let tmp = (await spotifyApi.getPlaylistTracks(q[2], {offset: erg.tracks.items.length})).body;

                            erg.tracks.items = erg.tracks.items.concat(tmp.items);
                        }

                        break;
                    default:
                        erg = null;
                }

                return {
                    type: q[1],
                    id: q[2],
                    object: erg
                }
            } else {
                return false;
            }
        } else if (this.isValidHttpUrl(song)) {
            let q = url.parse(song);
            let qq = q.pathname.split("/").splice(1);
            if ((q.hostname === "open.spotify.com") && (qq[0] === "track" || qq[0] === "album" || qq[0] === "playlist")) {
                let erg = null;
                await updateSpotifyAccessToken();

                switch (qq[0]) {
                    case "track":
                        erg = (await spotifyApi.getTrack(qq[1])).body;
                        break;
                    case "album":
                        erg = (await spotifyApi.getAlbum(qq[1])).body;
                        break;
                    case "playlist":
                        erg = (await spotifyApi.getPlaylist(qq[1])).body;
                        break;
                    default:
                        erg = null;
                }

                return {
                    type: qq[0],
                    id: qq[1],
                    object: erg
                }
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    /**
     * Parse soundcloud url
     * @param song Link to soundcloud
     * @returns {Promise<boolean|{id: string, type: string}>}
     */
    async parseSoundcloudUrl(song) {
        if (typeof song !== "string") {
            return false;
        }

        if (await SoundCloud.isValidUrl(song)) {
            let resSong = null, resPlaylist = null;

            try {
                resSong = await SoundCloud.getInfo(song, DisTubeOptions.soundcloudClientId);
                resPlaylist = await SoundCloud.getSetInfo(song, DisTubeOptions.soundcloudClientId);
            } catch (e) {
            }

            if (resPlaylist != null) {
                return {
                    type: "playlist",
                    id: resPlaylist.id,
                    res: resPlaylist
                }
            } else if (resSong != null) {
                return {
                    type: "track",
                    id: resSong.id,
                    res: resSong
                }
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    /**
     * `@2.0.0` Skip the playing song and play a song or a playlist
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|Song)} song Youtube url | Search string | {@link Distube#Song}
     * @throws {Error} If an error encountered
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "playSkip")
     *         distube.playSkip(message, args.join(" "));
     * });
     */
    async playSkip(message, song) {
        if (!song) return;
        try {
            let sc = await this.parseSoundcloudUrl(song);
            let spot = await this.parseSpotifyUrl(song);

            if (sc !== false && sc.type === "track") {
                await this._handleSong(message, await this._resolveSong(message, sc, "soundcloud_track"));
            } else if (sc !== false && sc.type === "playlist") {
                await this._handlePlaylist(message, song, false, "soundcloud_playlist", sc.id);
            } else if (spot !== false && spot.type === "playlist") {
                await this._handlePlaylist(message, song, true, "spotify_playlist", spot.id);
            } else if (spot !== false && spot.type === "album") {
                await this._handlePlaylist(message, song, true, "spotify_album", spot.id);
            } else if (spot !== false && spot.type === "track") {
                await this._handleSong(message, await this._resolveSong(message, spot.id, "spotify_track"));
            } else if (ytpl.validateURL(song)) {
                await this._handlePlaylist(message, song, true, "yt");
            } else {
                await this._handleSong(message, await this._resolveSong(message, song));
            }
        } catch (e) {
            this.emit("error", message, `playSkip(${song}) encountered: ${e}`);
        }
    }

    /**
     * `@2.1.0` Play or add array of Youtube video urls.
     * {@link DisTube#event:playList} or {@link DisTube#event:addList} will be emitted
     * with `playlist`'s properties include `properties` parameter's properties,
     * `user`, `items`, `total_items`, `duration`, `formattedDuration`, `thumbnail` like {@link ytpl_result}
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string[]} urls Array of Youtube url
     * @param {object} [properties={}] Additional properties such as `title`
     * @param {boolean} [playSkip=false] Weather or not play this playlist instantly
     * @example
     *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
     *     distube.playCustomPlaylist(message, songs, { title: "My playlist name" });
     */
    async playCustomPlaylist(message, urls, properties = {}, playSkip = false) {
        if (!urls.length) return;
        try {
            let songs = urls.map(song => ytdl.getBasicInfo(song, {requestOptions: this.requestOptions}).catch(e => {
                throw Error(song + " encountered an error: " + e)
            }));
            songs = await Promise.all(songs);
            let resolvedSongs = songs.filter(song => song);
            let duration = resolvedSongs.reduce((prev, next) => prev + parseInt(next.videoDetails.lengthSeconds, 10), 0);
            let thumbnails = resolvedSongs[0].videoDetails.thumbnail.thumbnails;
            let playlist = {
                thumbnail: thumbnails[thumbnails.length - 1].url,
                ...properties,
                user: message.author,
                items: resolvedSongs,
                total_items: resolvedSongs.length,
                duration: duration,
                formattedDuration: formatDuration(duration * 1000)
            };
            await this._handlePlaylist(message, playlist, playSkip);
        } catch (e) {
            this.emit("error", message, e);
        }
    }

    /**
     * PLay / add a playlist
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|object)} arg2 Youtube playlist url
     */
    async _handlePlaylist(message, arg2, skip = false, source = "yt", list = null) {
        let playlist = null
        if (typeof arg2 == "string") {
            if (source === "soundcloud_playlist" && arg2 !== null) {
                throw Error("SoundCloudSetsNotSupported");
                return;
            } else if ((source === "spotify_album" || source === "spotify_playlist") && list !== null && typeof list === "object") {
                let erg = list.object;

                if (erg != null) {
                    playlist = {
                        id: erg.id,
                        url: erg.external_urls.spotify,
                        title: erg.name,
                        total_items: erg.tracks.total,
                        items: [],
                        user: message.author,
                    };

                    for (let elem of erg.tracks.items) {
                        let song = {
                            id: (source === "spotify_album" ? elem.id : elem.track.id),
                            user: message.author,
                            name: `${(source === "spotify_album" ? elem.name : elem.track.name)} - ${(source === "spotify_album" ? erg.artists[0].name : elem.track.artists[0].name)}`,
                            duration: ((source === "spotify_album" ? (elem.duration_ms / 1000) : (elem.track.duration_ms / 1000))),
                            formattedDuration: (source === "spotify_album" ? duration(elem.duration_ms) : duration(elem.track.duration_ms)),
                            url: null,
                            website_url: null,
                            tracklist_url: null,
                            thumbnail: null,
                            related: null,
                            start_time: null,
                            type: "spotify_track"
                        }

                        song.title = song.name;
                        playlist.items.push(song);
                    }

                    playlist.duration = playlist.items.reduce((prev, next) => prev + next.duration, 0);
                    playlist.formattedDuration = formatDuration(playlist.duration * 1000);
                    //playlist.thumbnail = playlist.items[0].thumbnail;
                } else {
                    throw Error("SpotifyLinkNotFound");
                }
            } else {
                playlist = await ytpl(arg2, {limit: 0});
                playlist.items = playlist.items.reduce((res, vid) => {
                    if (typeof vid.duration != "undefined" && vid.duration != null && vid.duration != "null") {
                        res.push({
                            ...vid,
                            formattedDuration: vid.duration,
                            duration: toSecond(vid.duration)
                        });
                    }
                    return res;
                }, []);

                playlist.user = message.author;
                playlist.duration = playlist.items.reduce((prev, next) => prev + next.duration, 0);
                playlist.formattedDuration = formatDuration(playlist.duration * 1000);
                playlist.thumbnail = playlist.items[0].thumbnail;
            }
        } else if (typeof arg2 == "object")
            playlist = arg2;
        if (!playlist) throw Error("PlaylistNotFound");
        let videos = [...playlist.items];
        if (this.isPlaying(message)) {
            let queue = this._addVideosToQueue(message, videos, skip);
            if (skip) this.skip(message);
            else this.emit("addList", message, queue, playlist);
        } else {
            let resolvedSong = null;

            if (videos[0].type === "spotify_track") {
                let s = videos.shift();
                let search = await this._searchSong(message, s.name, false, 1);
                search.type = "yt";

                resolvedSong = search;
            } else {
                resolvedSong = new Song(videos.shift(), message.author);
            }

            let queue = await this._newQueue(message, resolvedSong).catch((e) => this.emit("error", message, e));
            this._addVideosToQueue(message, videos);
            this.emit("playList", message, queue, playlist, resolvedSong);
        }
    }

    /**
     * `@2.0.0` Search for a song. You can customize how user answers instead of send a number
     * (default of {@link DisTube#play}() search when `searchSongs` is `true`).
     * Then use {@link DisTube#play}(message, aResultToPlay) or {@link DisTube#playSkip}() to play it.
     * @async
     * @param {string} string The string search for
     * @throws {NotFound} If not found
     * @throws {Error} If an error encountered
     * @returns {Promise<Song[]>} Array of results
     */
    async search(string) {
        let search = await ytsr(string, {limit: 12});
        let videos = search.items.filter(val => val.duration || val.type == 'video');
        if (videos.length === 0) throw Error("NotFound");
        videos = videos.map(video => ytdl.getBasicInfo(video.link, {requestOptions: this.requestOptions}).catch(() => null));
        videos = await Promise.all(videos);
        let songs = videos.filter(v => v).map(video => new Song(video, null));
        return songs;
    }

    /**
     * Search for a song, fire {@link DisTube#event:error} if not found.
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {string} name The string search for
     * @throws {Error}
     * @returns {Song} Song info
     */
    async _searchSong(message, name, emit = true, limit = 12, type = "yt", thumbnail = null) {
        let search = await ytsr(name, {limit: limit});
        let videos = search.items.filter(val => val.duration || val.type == 'video');
        if (videos.length === 0) throw "SearchNotFound";
        let song = videos[0];
        if (this.options.searchSongs) {
            try {
                if (emit) this.emit("searchResult", message, videos);
                let answers = await message.channel.awaitMessages(m => m.author.id === message.author.id, {
                    max: 1,
                    time: 60000,
                    errors: ["time"]
                })
                if (!answers.first()) throw Error();
                let index = parseInt(answers.first().content, 10);
                if (isNaN(index) || index > videos.length || index < 1) {
                    if (emit) this.emit("searchCancel", message);
                    return;
                }
                song = videos[index - 1];
            } catch(e) {
                if (emit) this.emit("searchCancel", message);
                return;
            }
        }
        song = await ytdl.getBasicInfo(song.link, {requestOptions: this.requestOptions})
        return new Song(song, message.author, type, thumbnail);
    }

    /**
     * Create a new guild queue
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {Song} song Song to play
     * @throws {NotInVoice} if user not in a voice channel
     * @returns {Promise<Queue>}
     */
    async _newQueue(message, song) {
        let queue = new Queue(message);
        this.emit("initQueue", queue);
        this.guildQueues.set(message.guild.id, queue);
        let voice = message.member.voice.channel;
        if (!voice) throw new Error("NotInVoice");
        queue.connection = await voice.join().catch(err => {
            this._deleteQueue(message);
            throw Error("DisTubeCanNotJoinVChannel: " + err);
        });
        queue.songs.push(song);
        queue.updateDuration();
        this._playSong(message);
        return queue;
    }

    /**
     * Delete a guild queue
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     */
    _deleteQueue(message) {
        this.guildQueues.delete(message.guild.id);
    }

    /**
     * Get the guild queue
     * @param {Discord.Message} message The message from guild channel5643
     * @returns {Queue} The guild queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "queue") {
     *         let queue = distube.getQueue(message);
     *         message.channel.send('Current queue:\n' + queue.songs.map((song, id) =>
     *             `**${id+1}**. [${song.name}](${song.url}) - \`${song.formattedDuration}\``
     *         ).join("\n"));
     *     }
     * });
     */
    getQueue(message) {
        if (!message || !message.guild) throw Error("InvalidDiscordMessage");
        let queue = this.guildQueues.get(message.guild.id);
        return queue;
    }

    /**
     * Add a video to queue
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {Song} song Song to add
     * @throws {NotInVoice} if result is empty
     * @returns {Queue}
     */
    _addToQueue(message, song, unshift = false, stream = false) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        if (!song) throw new Error("NoSong");
        if (unshift) {
            let playing = queue.songs.shift();
            queue.songs.unshift(playing, song);
        } else queue.songs.push(song);
        queue.updateDuration();
        return queue;
    }

    /**
     * Add a array of videos to queue
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {ytdl.videoInfo[]} videos Array of song to add
     * @returns {Queue}
     */
    async _addVideosToQueue(message, videos, unshift = false) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");

        let songs = null;

        if (videos[0].type === "spotify_track") {
            songs = videos;
        } else {
            songs = videos.map(v => new Song(v, message.author));
        }

        if (unshift) {
            let playing = queue.songs.shift();
            queue.songs.unshift(playing, ...songs);
        } else queue.songs.push(...songs);
        queue.updateDuration();
        return queue;
    }

    /**
     * Pause the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    pause(message) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        queue.playing = false;
        queue.pause = true;
        queue.dispatcher.pause();
        return queue;
    }

    /**
     * Resume the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    resume(message) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        queue.playing = true;
        queue.pause = false;
        queue.dispatcher.resume();
        return queue;
    }

    /**
     * Stop the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "stop") {
     *         distube.stop(message);
     *         message.channel.send("Stopped the queue!");
     *     }
     * });
     */
    stop(message) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        queue.stopped = true;
        queue.dispatcher.end();
        if (this.options.leaveOnStop) queue.connection.channel.leave();
        this._deleteQueue(message);
    }

    /**
     * Set the guild stream's volume
     * @param {Discord.Message} message The message from guild channel
     * @param {number} percent The percentage of volume you want to set
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "volume")
     *         distube.setVolume(message, args[0]);
     * });
     */
    setVolume(message, percent) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        queue.volume = percent;
        queue.dispatcher.setVolume(queue.volume / 100);
        return queue
    }

    /**
     * Skip the playing song
     *
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     * @throws {NoSong} if there is no song in queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "skip")
     *         distube.skip(message);
     * });
     */
    skip(message) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        if (queue.songs <= 1 && !queue.autoplay) throw new Error("NoSong");
        queue.skipped = true;
        queue.dispatcher.end();
        return queue;
    }

    /**
     * Shuffle the guild queue songs
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "shuffle")
     *         distube.shuffle(message);
     * });
     */
    shuffle(message) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        let playing = queue.songs.shift();
        for (let i = queue.songs.length - 1; i > 0; i--) {
            let j = Math.floor(Math.random() * (i + 1));
            [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
        }
        queue.songs.unshift(playing);
        return queue;
    }

    /**
     * Jump to the song number in the queue.
     * The next one is 1,...
     * @param {Discord.Message} message The message from guild channel
     * @param {number} num The song number to play
     * @returns {Queue} The guild queue
     * @throws {InvalidSong} if `num` is invalid number (0 < num < {@link Queue#songs}.length)
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "jump")
     *         distube.jump(message, parseInt(args[0]))
     *             .catch(err => message.channel.send("Invalid song number."));
     * });
     */
    jump(message, num) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        if (num > queue.songs.length || num < 1) throw new Error("InvalidSong");
        queue.songs = queue.songs.splice(num - 1);
        queue.skipped = true;
        queue.dispatcher.end();
        return queue;
    }

    /**
     * Set the repeat mode of the guild queue.
     * Turn off if repeat mode is the same value as new mode.
     * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
     *
     * @param {Discord.Message} message The message from guild channel
     * @param {number} mode The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
     * @returns {number} The new repeat mode
     *
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "repeat") {
     *         let mode = distube.setRepeatMode(message, parseInt(args[0]));
     *         mode = mode ? mode == 2 ? "Repeat queue" : "Repeat song" : "Off";
     *         message.channel.send("Set repeat mode to `" + mode + "`");
     *     }
     * });
     */
    setRepeatMode(message, mode = null) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        mode = parseInt(mode, 10);
        if (!mode && mode !== 0) queue.repeatMode = (queue.repeatMode + 1) % 3;
        else if (queue.repeatMode == mode) queue.repeatMode = 0;
        else queue.repeatMode = mode;
        return queue.repeatMode;
    }

    /**
     * Toggle autoplay mode
     * @param {Discord.Message} message The message from guild channel
     * @returns {boolean} Autoplay mode state
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "autoplay") {
     *         let mode = distube.toggleAutoplay(message);
     *         message.channel.send("Set autoplay mode to `" + (mode ? "On" : "Off") + "`");
     *     }
     * });
     */
    toggleAutoplay(message) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        queue.autoplay = !queue.autoplay;
        return queue.autoplay;
    }

    /**
     * Whether or not a guild is playing or paused music.
     * @param {Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild is playing song(s)
     */
    isPlaying(message) {
        if (!message || !message.guild) throw Error("InvalidDiscordMessage");
        let queue = this.guildQueues.get(message.guild.id);
        return queue ? (queue.playing || !queue.pause) : false;
    }

    /**
     * Whether or not the guild queue is paused
     * @param {Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild queue is paused
     */
    isPaused(message) {
        if (!message || !message.guild) throw Error("InvalidDiscordMessage");
        let queue = this.guildQueues.get(message.guild.id);
        return queue ? queue.pause : false;
    }

    /**
     * Whether or not the queue's voice channel is empty
     * @private
     * @ignore
     * @param {Queue} queue The guild queue
     * @returns {boolean} No user in voice channel return `true`
     */
    _isVoiceChannelEmpty(queue) {
        let voiceChannel = queue.connection.channel;
        let members = voiceChannel.members.filter(m => !m.user.bot);
        return !members.size;
    }

    /**
     * Add related song to the queue
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @returns {Promise<Queue>} The guild queue
     */
    async runAutoplay(message) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        let song = queue.songs[0];

        if (song.type !== "yt") {
            song = await this._searchSong(message, song.name, false, 1, "yt");
        }

        let related = song.related;
        if (!related) {
            related = await ytdl.getBasicInfo(song.url, {requestOptions: this.requestOptions});
            related = related.related_videos;
        }
        message.autoplay = true;
        related = related.filter(v => v.length_seconds != 'undefined')
        if (related && related[0]) {
            let song = await ytdl.getBasicInfo(related[0].id, {requestOptions: this.requestOptions});
            let nextSong = new Song(song, this.client.user);
            this._addToQueue(message, nextSong);
        } else {
            this.emit("noRelated", message);
        }
        return queue;
    }

    /**
     * `@2.0.0` Enable or disable a filter of the queue, replay the playing song.
     * Available filters: {@link Filter}
     *
     * @param {Discord.Message} message The message from guild channel
     * @param {Filter} filter A filter name
     * @returns {string} Current queue's filter name.
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if ([`3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`].includes(command)) {
     *         let filter = distube.setFilter(message, command);
     *         message.channel.send("Current queue filter: " + (filter || "Off"));
     *     }
     * });
     */
    setFilter(message, filter) {
        let queue = this.getQueue(message);
        if (!queue) throw new Error("NotPlaying");
        if (!Object.prototype.hasOwnProperty.call(ffmpegFilters, filter)) throw TypeError("filter must be a Filter (https://DisTube.js.org/DisTube.html#setFilter).");
        // Multiple filters
        // if (queue.filters.includes(filter))
        //   queue.filters = queue.filters.filter(f => f != filter);
        // else
        //   queue.filters.push(filter);
        if (queue.filter == filter) queue.filter = null;
        else queue.filter = filter;
        this._playSong(message, false);
        if (!this.options.emitNewSongOnly) this.emit("playSong", message, queue, queue.songs[0]);
        return queue.filter;
    }

    /**
     * Check if string is a valid url
     * @param string Url
     * @returns {boolean}
     */
    isValidHttpUrl(string) {
        let url;

        try {
            url = new URL(string);
        } catch (_) {
            return false;
        }

        return url.protocol === "http:" || url.protocol === "https:";
    }

    _emitPlaySong(queue) {
        if (
            !this.options.emitNewSongOnly ||
            (
                queue.repeatMode != 1 &&
                (!queue.songs[1] || queue.songs[0].id !== queue.songs[1].id)
            )
        ) return true;
        return false;
    }

    /**
     * Play a song on voice connection
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     */
    async _playSong(message, emit = true) {
        let queue = this.getQueue(message);
        queue.songs[0].start_time = moment().unix();
        this.guildQueues.set(message.guild.id, queue);

        if (!queue) return;
        let encoderArgs = queue.filter ? ["-af", ffmpegFilters[queue.filter]] : null;
        try {
            let dispatcher = null;

            if (queue.songs[0].type === "soundcloud_track") {
                const transcoder = new prism.FFmpeg({
                    args: [
                        '-analyzeduration', '0',
                        '-loglevel', '0',
                        '-f', 's16le',
                        '-ar', '48000',
                        '-ac', '2',
                        '-af', (encoderArgs === null ? "" : encoderArgs[1])
                    ],
                });
                //const opus = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });

                const input = await soundcloud.getStream(queue.songs[0].id);
                const output = input.pipe(transcoder);
                //const outputStream = output.pipe(opus);
                //outputStream.on("close", () => {
                //    transcoder.destroy();
                //    opus.destroy();
                //});

                dispatcher = queue.connection.play(soundcloud.getStream(queue.songs[0].id), {
                    highWaterMark: 1,
                    type: 'converted',
                    volume: queue.volume / 100
                });

            } else if (queue.songs[0].type === "spotify_track") {
                let search = await this._searchSong(message, queue.songs[0].name, false, 1);
                search.type = "yt";

                queue.songs[0] = search;

                this.guildQueues.set(message.guild.id, queue);

                dispatcher = queue.connection.play(ytdl(queue.songs[0].url, {
                    opusEncoded: true,
                    filter: 'audioonly',
                    quality: 'highestaudio',
                    highWaterMark: this.options.highWaterMark,
                    requestOptions: this.requestOptions,
                    // encoderArgs: ['-af', filters.map(filter => ffmpegFilters[filter]).join(",")]
                    encoderArgs,
                }), {
                    highWaterMark: 1,
                    type: 'opus',
                    volume: queue.volume / 100
                });
            } else if (queue.songs[0].type === "stream") {
                dispatcher = queue.connection.play(queue.songs[0].url, {
                    highWaterMark: 512,
                    bitrate: 128,
                    fec: true,
                    volume: queue.volume / 100
                });
            } else {
                dispatcher = queue.connection.play(ytdl(queue.songs[0].url, {
                    opusEncoded: true,
                    filter: 'audioonly',
                    quality: 'highestaudio',
                    highWaterMark: this.options.highWaterMark,
                    requestOptions: this.requestOptions,
                    // encoderArgs: ['-af', filters.map(filter => ffmpegFilters[filter]).join(",")]
                    encoderArgs,
                }), {
                    highWaterMark: 1,
                    type: 'opus',
                    volume: queue.volume / 100
                });
            }

            queue.dispatcher = dispatcher;

            dispatcher
                .on("finish", async () => {
                    if (queue.stopped) return;
                    if (this.options.leaveOnEmpty && this._isVoiceChannelEmpty(queue)) {
                        this._deleteQueue(message);
                        queue.connection.channel.leave();
                        return this.emit("empty", message);
                    }
                    if (queue.repeatMode == 2 && !queue.skipped) queue.songs.push(queue.songs[0]);
                    if (queue.songs.length <= 1 && (queue.skipped || !queue.repeatMode)) {
                        if (queue.songs[0].type !== "stream" && queue.autoplay) await this.runAutoplay(message);
                        if (queue.songs.length <= 1) {
                            this._deleteQueue(message);
                            if (this.options.leaveOnFinish && !queue.stopped)
                                queue.connection.channel.leave();
                            if (!queue.autoplay) this.emit("finish", message);
                            return;
                        }
                    }
                    queue.skipped = false;
                    if (queue.repeatMode != 1 || queue.skipped) queue.removeFirstSong();
                    else queue.updateDuration();

                    if (queue.songs[0].type === "spotify_track") {
                        let search = await this._searchSong(message, queue.songs[0].name, false, 1);
                        search.type = "yt";

                        queue.songs[0] = search;

                        this.guildQueues.set(message.guild.id, queue);
                    }

                    if (this._emitPlaySong(queue) && emit) this.emit("playSong", message, queue, queue.songs[0]);
                    return this._playSong(message);
                })
                .on("error", e => {
                    console.error(e);
                    this.emit("error", message, "DispatcherErrorWhenPlayingSong");
                    queue.removeFirstSong();
                    if (queue.songs.length > 0) {
                        if (emit) this.emit("playSong", message, queue, queue.songs[0]);
                        this._playSong(message);
                    }
                });
        } catch (e) {
            console.log(e);
            this.emit("error", message, `Cannot play \`${queue.songs[0].id}\`. Error: \`${e}\``);
        }
    }
}

module.exports = DisTube;

/**
 * Youtube playlist author
 * @typedef {object} ytpl_author
 * @prop {string} id Channel id
 * @prop {string} name Channel name
 * @prop {string} avatar Channel avatar
 * @prop {string} channel_url Channel url
 * @prop {string} user User id
 * @prop {string} user_url User url
 */

/**
 * Youtube playlist item
 * @typedef {object} ytpl_item
 * @prop {string} id Video id
 * @prop {string} url Video url
 * @prop {string} url_simple Video shorten url
 * @prop {string} title Video title
 * @prop {string} thumbnail Video thumbnail url
 * @prop {string} formattedDuration Video duration `hh:mm:ss`
 * @prop {number} duration Video duration in seconds
 * @prop {ytpl_author} author Video channel
 */

/**
 * Youtube playlist info
 * @typedef {object} ytpl_result
 * @prop {Discord.User} user `@1.2.0` Requested user
 * @prop {string} id Playlist id
 * @prop {string} url Playlist url
 * @prop {string} title Playlist title
 * @prop {string} thumbnail `@2.1.0` Playlist thumbnail url
 * @prop {string} formattedDuration Playlist duration `hh:mm:ss`
 * @prop {number} duration Playlist duration in seconds
 * @prop {number} total_items The number of videos in the playlist
 * @prop {ytpl_author} author The playlist creator
 * @prop {ytpl_item[]} items Array of videos
 */

/**
 *  Emitted after DisTube add playlist to guild queue
 *
 * @event DisTube#addList
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {ytpl_result} playlist Playlist info
 * @since 1.1.0
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("addList", (message, queue, playlist) => message.channel.send(
 *     `Added \`${playlist.title}\` playlist (${playlist.total_items} songs) to queue\n${status(queue)}`
 * ));
 */

/**
 *  Emitted after DisTube add new song to guild queue
 *
 * @event DisTube#addSong
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {Song} song Added song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("addSong", (message, queue, song) => message.channel.send(
 *     `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}`
 * ));
 */

/**
 * Emitted when there is no user in VoiceChannel and {@link DisTubeOptions}.leaveOnEmpty is `true`.
 *
 * @event DisTube#empty
 * @param {Discord.Message} message The message from guild channel
 * @example
 * distube.on("empty", message => message.channel.send("Channel is empty. Leaving the channel"))
 */

/**
 * Emitted when {@link DisTube} encounters an error.
 *
 * @event DisTube#error
 * @param {Discord.Message} message The message from guild channel
 * @param {Error} err The error encountered
 * @example
 * distube.on("error", (message, err) => message.channel.send(
 *     "An error encountered: " + err
 * ));
 */

/**
 * Emitted when there is no more song in the queue and {@link Queue#autoplay} is `false`.
 * DisTube will leave voice channel if {@link DisTubeOptions}.leaveOnFinish is `true`
 *
 * @event DisTube#finish
 * @param {Discord.Message} message The message from guild channel
 * @example
 * distube.on("finish", message => message.channel.send("No more song in queue"));
 */

/**
 * `@2.3.0` Emitted when DisTube initialize a queue to change queue default properties.
 *
 * @event DisTube#initQueue
 * @param {Queue} queue The guild queue
 * @example
 * distube.on("initQueue", queue => {
 *     queue.autoplay = false;
 *     queue.volume = 100;
 * });
 */

/**
 * Emitted when {@link Queue#autoplay} is `true`, the {@link Queue#songs} is empty and
 * DisTube cannot find related songs to play
 *
 * @event DisTube#noRelated
 * @param {Discord.Message} message The message from guild channel
 * @example
 * distube.on("noRelated", message => message.channel.send("Can't find related video to play. Stop playing music."));
 */

/**
 * Emitted after DisTube play the first song of the playlist
 * and add the rest to the guild queue
 *
 * @event DisTube#playList
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {ytpl_result} playlist Playlist info
 * @param {Song} song Playing song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("playList", (message, queue, playlist, song) => message.channel.send(
 *     `Play \`${playlist.title}\` playlist (${playlist.total_items} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
 * ));
 */

/**
 * Emitted when DisTube play a song.
 * If {@link DisTubeOptions}.emitNewSongOnly is `true`, event is not emitted when looping a song or next song is the previous one
 *
 * @event DisTube#playSong
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {Song} song Playing song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("playSong", (message, queue, song) => message.channel.send(
 *     `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}\n${status(queue)}`
 * ));
 */

/**
 * Emitted when {@link DisTubeOptions}.searchSongs is `true`.
 * Search will be canceled if user's next message is invalid number or timeout (60s)
 *
 * @event DisTube#searchCancel
 * @param {Discord.Message} message The message from guild channel
 * @example
 * // DisTubeOptions.searchSongs = true
 * distube.on("searchCancel", (message) => message.channel.send(`Searching canceled`));
 */

/**
 * Emitted when {@link DisTubeOptions}.searchSongs is `true`.
 * DisTube will wait for user's next message to choose song manually
 * if song param of {@link DisTube#play}() is invalid url
 *
 * @event DisTube#searchResult
 * @param {Discord.Message} message The message from guild channel
 * @param {Song[]} result Searched result (max length = 12)
 * @example
 * // DisTubeOptions.searchSongs = true
 * distube.on("searchResult", (message, result) => {
 *     let i = 0;
 *     message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.title} - \`${song.duration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
 * });
 */

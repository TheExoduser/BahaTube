const ytdl = require("@skick/discord-ytdl-core"),
    ytsr = require("ytsr"),
    ytpl = require("ytpl"),
    {EventEmitter} = require("events"),
    Queue = require("./Queue"),
    Song = require("./Song"),
    Playlist = require("./Playlist"),
    Discord = require("discord.js"),
    youtube_dl = require('youtube-dl'),
    path = require('path'),
    fs = require('fs'),
    {promisify} = require('util'),
    youtube_dlOptions = ["--no-warnings", "--force-ipv4"],
    { formatDuration, toSecond } = require("./duration"),
    moment = require("moment"),
    spotify = require("spotify-web-api-node"),
    url = require("url"),
    yts = require("youtube-api-v3-search"),
    fetch = require("node-fetch");
youtube_dl.getInfo = promisify(youtube_dl.getInfo);
const binPath = path.join(__dirname, "../youtube-dl/youtube-dl" + (process.platform === 'win32' || process.env.NODE_PLATFORM === 'windows' ? ".exe" : ""));
fs.chmodSync(binPath, '777');
youtube_dl.setYtdlBinary(binPath);

const isURL = (string) => {
  try { new URL(string) } catch { return false }
  return true;
}

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
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if channel is empty in 60s. (Avoid accident leaving)
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using {@link DisTube#stop|stop()} function.
 * @prop {boolean} [searchSongs=false] Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
 * @prop {string} [youtubeCookie=null] `@2.4.0` YouTube cookies. How to get it: {@link https://github.com/fent/node-ytdl-core/blob/784c04eaf9f3cfac0fe0933155adffe0e2e0848a/example/cookies.js#L6-L12|YTDL's Example}
 * @prop {string} [youtubeIdentityToken=null] `@2.4.0` If not given, ytdl-core will try to find it. You can find this by going to a video's watch page, viewing the source, and searching for "ID_TOKEN".
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
	spotifyClientId: null,
	spotifyClientSecret: null
};

/**
 * DisTube audio filters.
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

/*
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
*/
const spotifyApi = new spotify();

/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
class DisTube extends EventEmitter {
  /**
   * DisTube's current version.
   * @type {string}
   * @ignore
   */
  get version() { return require("../package.json").version }
  static get version() { return require("../package.json").version }
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
     * @type {Discord.Collection<string, Queue>}
     */
    this.guildQueues = new Discord.Collection();

    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    this.options = DisTubeOptions;
    for (let key in otp)
      this.options[key] = otp[key];

    this.requestOptions = this.options.youtubeCookie ? { headers: { cookie: this.options.youtubeCookie, 'x-youtube-identity-token': this.options.youtubeIdentityToken } } : undefined;

    client.on("voiceStateUpdate", (oldState, newState) => {
      if (newState && newState.id == client.user.id && !newState.channelID) {
        let queue = this.guildQueues.find((gQueue) => gQueue.connection && gQueue.connection.channel.id == oldState.channelID);
        if (!queue) return;
        let guildID = queue.connection.channel.guild.id;
        try { this.stop(guildID) } catch { this._deleteQueue(guildID) }
      }
      if (this.options.leaveOnEmpty && oldState && oldState.channel) {
        let queue = this.guildQueues.find((gQueue) => gQueue.connection && gQueue.connection.channel.id == oldState.channelID);
        if (queue && this._isVoiceChannelEmpty(queue)) {
          setTimeout((queue) => {
            let guildID = queue.connection.channel.guild.id;
            if (this.guildQueues.has(guildID) && this._isVoiceChannelEmpty(queue)) {
              queue.connection.channel.leave();
              this.emit("empty", queue.initMessage);
              this._deleteQueue(queue.initMessage);
            }
          }, 60000, queue)
        }
      }
    })

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
   * @param {string|Song} song Youtube url | Search string | {@link Song}
   * @private
   * @ignore
   * @returns {Promise<Song|Song[]>} Resolved Song
   */
  async _resolveSong(message, song, type = "yt") {
    if (song instanceof Song) {
      song.user = message.author;
      return song;
    }
    if (typeof song === "object")
      return new Song(song, message.author)
    if (type === "spotify_track") {
      await updateSpotifyAccessToken();

      let s = (await spotifyApi.getTrack(song)).body;
      return this._searchSong(message, `${s.name} ${s.artists[0].name}`, true, 1);
    }
    if (ytdl.validateURL(song))
      return new Song(await ytdl.getBasicInfo(song, { requestOptions: this.requestOptions }), message.author, true);
    if (isURL(song)) {
      let info = await youtube_dl.getInfo(song, youtube_dlOptions).catch(e => { throw new Error(e.stderr) })
      if (Array.isArray(info) && info.length > 0) return info.map(i => new Song(i, message.author));
      return new Song(info, message.author)
    }
    return await this._searchSong(message, song, true, 1);
  }

	/**
	 * Handle a Song or an array of Song
	 * @async
	 * @param {Discord.Message} message The message from guild channel
	 * @param {string|Song} song Youtube url | Search string | {@link Song}
	 * @private
	 * @ignore
	 */
	async _handleSong(message, song, skip = false) {
		if (!song) {
			return;
		}
		if (Array.isArray(song)) {
			return this._handlePlaylist(message, song, skip);
		}
		if (this.getQueue(message)) {
			let queue = this._addToQueue(message, song, skip);
			if (skip) {
				this.skip(message);
			} else {
				this.emit("addSong", message, queue, song);
			}
		} else {
			let queue = await this._newQueue(message, song);
			//this.emit("playSong", message, queue, song);
		}
	}

	/**
	 * Play / add a song from Youtube video url or playlist from Youtube playlist url. Search and play a song if it is not a valid url.
	 * @async
	 * @param {Discord.Message} message The message from guild channel
	 * @param {string|Song} song Youtube url | Search string | {@link Song}
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
		if (!song) {
			return;
		}
		try {
			let spot = await this.parseSpotifyUrl(song);

			if (spot !== false && spot.type === "playlist") {
				await this._handlePlaylist(message, song, false, "spotify_playlist", spot);
			} else if (spot !== false && spot.type === "album") {
				await this._handlePlaylist(message, song, false, "spotify_album", spot);
			} else if (spot !== false && spot.type === "track") {
				await this._handleSong(message, await this._resolveSong(message, spot.id, "spotify_track"));
			} else if (ytpl.validateID(song)) {
				await this._handlePlaylist(message, song);
			} else {
				await this._handleSong(message, await this._resolveSong(message, song));
			}
		} catch (e) {
			//e.message = `play(${song}) encountered: ${e.message}`;
			this._emitError(message, e);
		}
	}

	/**
	 * `@2.0.0` Skip the playing song and play a song or a playlist
	 * @async
	 * @param {Discord.Message} message The message from guild channel
	 * @param {string|Song} song Youtube url | Search string | {@link Song}
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
		if (!song) {
			return;
		}
		try {
			let spot = await this.parseSpotifyUrl(song);

			if (spot !== false && spot.type === "playlist") {
				await this._handlePlaylist(message, song, true, "spotify_playlist", spot);
			} else if (spot !== false && spot.type === "album") {
				await this._handlePlaylist(message, song, true, "spotify_album", spot);
			} else if (spot !== false && spot.type === "track") {
				await this._handleSong(message, await this._resolveSong(message, spot.id, "spotify_track"), true);
			} else if (ytpl.validateID(song)) {
				await this._handlePlaylist(message, song, true);
			} else {
				await this._handleSong(message, await this._resolveSong(message, song), true);
			}
		} catch (e) {
			//e.message = `playSkip(${song}) encountered: ${e.message}`;
			this._emitError(message, e);
		}
	}

	async playStream(message, name, icon, sourceUrl, websiteUrl, tracklistUrl) {
		if (!sourceUrl) {
			return;
		}

		try {
			let song = {
				youtube: false,
				id: null,
				user: message.author,
				name: name,
				duration: 0,
				formattedDuration: null,
				url: sourceUrl,
				streamURL: sourceUrl,
				website_url: websiteUrl,
				tracklist_url: tracklistUrl,
				thumbnail: icon,
				related: null,
				isLive: null,
				plays: null,
				likes: null,
				dislikes: null,
				reposts: null,
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
		} else if (isURL(song)) {
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
	 * `@2.1.0` Play or add array of Youtube video urls.
	 * {@link DisTube#event:playList} or {@link DisTube#event:addList} will be emitted
	 * with `playlist`'s properties include `properties` parameter's properties,
	 * `user`, `items`, `total_items`, `duration`, `formattedDuration`, `thumbnail` like {@link Playlist}
	 * @async
	 * @param {Discord.Message} message The message from guild channel
	 * @param {string[]} urls Array of Youtube url
	 * @param {object} [properties={}] Additional properties such as `title`
	 * @param {boolean} [playSkip=false] Whether or not play this playlist instantly
	 * @example
	 *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
	 *     distube.playCustomPlaylist(message, songs, { title: "My playlist name" });
	 */
	async playCustomPlaylist(message, urls, properties = {}, playSkip = false) {
		if (!urls.length) {
			return;
		}
		try {
			let songs = urls.filter(url => isURL(url)).map(url => this._resolveSong(message, url).catch(() => {
			}));
			songs = (await Promise.all(songs)).filter(song => song);
			let playlist = new Playlist(songs, message.author, properties);
			await this._handlePlaylist(message, playlist, playSkip);
		} catch (e) {
			this._emitError(message, e);
		}
	}

	/**
	 * PLay / add a playlist
	 * @async
	 * @private
	 * @ignore
	 * @param {Discord.Message} message The message from guild channel
	 * @param {string|Song[]|Playlist} arg2 Youtube playlist url | a Playlist
	 */
	async _handlePlaylist(message, arg2, skip = false, source = "yt", list = null) {
		let playlist;
		if (typeof arg2 === "object") {
			playlist = arg2;
		}// Song[] or Playlist
		else if ((source === "spotify_album" || source === "spotify_playlist") && list !== null && typeof list === "object") {
			let erg = list.object;

			if (erg != null) {
				playlist = {
					id: erg.id,
					url: erg.external_urls.spotify,
					name: erg.name,
					songs: [],
					user: message.author,
					author: message.author
				};

				for (let elem of erg.tracks.items) {
					let song = {
						youtube: false,
						id: (source === "spotify_album" ? elem.id : elem.track.id),
						user: message.author,
						name: `${(source === "spotify_album" ? elem.name : elem.track.name)} - ${(source === "spotify_album" ? erg.artists[0].name : elem.track.artists[0].name)}`,
						duration: ((source === "spotify_album" ? (elem.duration_ms / 1000) : (elem.track.duration_ms / 1000))),
						formattedDuration: (source === "spotify_album" ? formatDuration(elem.duration_ms) : formatDuration(elem.track.duration_ms)),
						url: null,
						streamURL: null,
						website_url: null,
						tracklist_url: null,
						thumbnail: null,
						related: null,
						isLive: null,
						plays: null,
						likes: null,
						dislikes: null,
						reposts: null,
						start_time: null,
						type: "spotify_track"
					}

					song.title = song.name;
					playlist.songs.push(song);
				}
			} else {
				throw Error("SpotifyLinkNotFound");
			}
		}
		else if (typeof arg2 === "string") {
			playlist = await ytpl(arg2, {limit: Infinity});
			playlist.items = playlist.items.filter(v => !v.thumbnail.includes("no_thumbnail")).map(v => new Song(v, message.author, true));
		}
		if (!(playlist instanceof Playlist)) {
			try {
				playlist = new Playlist(playlist, message.author)
			} catch {
				// Don't remove custom playlist
				//playlist = null
			}
		}
		if (!playlist) {
			throw Error("Invalid Playlist");
		}
		if (!playlist.songs.length) {
			throw Error("No valid video in the playlist");
		}
		let songs = playlist.songs;
		let queue = this.getQueue(message);
		if (queue) {
			this._addSongsToQueue(message, songs, skip);
			if (skip) {
				this.skip(message);
			} else {
				this.emit("addList", message, queue, playlist);
			}
		} else {
			queue = await this._newQueue(message, songs.shift());
			this._addSongsToQueue(message, songs);
			this.emit("playList", message, queue, playlist, queue.songs[0]);
		}
	}

	/**
	 * `@2.0.0` Search for a song. You can customize how user answers instead of send a number.
	 * Then use {@link DisTube#play|play(message, aResultFromSearch)} or {@link DisTube#playSkip|playSkip()} to play it.
	 * @async
	 * @param {string} string The string search for
	 * @param {number} retried How often the function has been retried
	 * @param {number} limit The max count of results to retrieve
	 * @param {Discord.Message} message The message from guild channel
	 * @throws {NotFound} If not found
	 * @throws {Error} If an error encountered
	 * @returns {Promise<Song[]>} Array of results
	 */
	async search(string, retried = 0, limit = 12, message) {
		try {
			let videos = [];

			try {
				let opts = {
					q: string,
					part: "snippet",
					type: "video",
					maxResults: limit
				}

				let search = await yts(DisTubeOptions.youtubeIdentityToken, opts);

				if (search.items) {
					for (let item of search.items) {
						item.url = "https://www.youtube.com/watch?v=" + item.id.videoId;
						item.name = item.snippet.title;
						item.title = item.name;

						let req = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${item.id.videoId}&part=contentDetails&key=${DisTubeOptions.youtubeIdentityToken}`);
						req = await req.json();

						item.duration = moment.duration(req.items[0].contentDetails.duration).asSeconds();
						item.formattedDuration = formatDuration(item.duration * 1000);

						videos.push(item);
					}
				} else {
					throw Error("No result!");
				}
			} catch (e) {
				console.log(e);
				// if api error, search using ytsr
				let search = await ytsr(string, {limit: limit});

				videos = search.items.filter(val => val.type === 'video' && val.link).map(vid => new Song({
					...vid,
					id: vid.link.match(/^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/)[7],
				}, null, true));
			}

			if (videos.length === 0) {
				await new Promise(r => setTimeout(r, 1000));
				return this.search(string, ++retried, limit, message);
			}
			return videos;
		} catch (e) {
			console.log(e);
			if (retried > 3) {
				throw Error("No result!");
			}
			await new Promise(r => setTimeout(r, 1000));
			return this.search(string, ++retried, limit, message);
		}
	}

	/**
	 * Search for a song, fire {@link DisTube#event:error} if not found.
	 * @async
	 * @private
	 * @ignore
	 * @param {Discord.Message} message The message from guild channel
	 * @param {string} name The string search for
	 * @param {boolean} emit Should this function emit any events
	 * @param {number} limit The string search for
	 * @returns {Song} Song info
	 */
	async _searchSong(message, name, emit = true, limit = 12) {
		let songs = await this.search(name, 0, limit, message);

		let song = songs[0];
		song = new Song(await ytdl.getBasicInfo(song.url, {requestOptions: this.requestOptions}), message.author, true);

		if (this.options.searchSongs) {
			try {
				this.emit("searchResult", message, songs);
				let answers = await message.channel.awaitMessages(m => m.author.id === message.author.id, {
					max: 1,
					time: 60000,
					errors: ["time"]
				})
				if (!answers.first()) {
					throw Error();
				}
				let index = parseInt(answers.first().content, 10);
				if (isNaN(index) || index > songs.length || index < 1) {
					if (emit) this.emit("searchCancel", message);
					return;
				}
				song = songs[index - 1];
			} catch {
				if (emit) this.emit("searchCancel", message);
				return;
			}
		}
		song.user = message.author;
		return song;
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
    let voice = message.member.voice.channel;
    if (!voice) throw new Error("User is not in the voice channel.");
    let queue = new Queue(message);
    this.emit("initQueue", queue);
    this.guildQueues.set(message.guild.id, queue);
    queue.connection = await voice.join().catch(err => {
      this._deleteQueue(message);
      throw Error("DisTube cannot join the voice channel: " + err);
    });
    if (!queue.connection) return;
    queue.connection.on("error", e => {
      e.message = "There is a problem with Discord Voice Connection.\nPlease try again! Sorry for the interruption!\nReason: " + e.message;
      this._emitError(message, e);
      this._deleteQueue(message);
    })
    queue.songs.push(song);
    this._playSong(message);
    return queue;
  }

  /**
   * Delete a guild queue
   * @private
   * @ignore
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   */
  _deleteQueue(message) {
    let queue = this.getQueue(message);
    if (!queue) return;
    if (queue.dispatcher) try { queue.dispatcher.destroy() } catch { }
    if (queue.stream) try { queue.stream.destroy() } catch { }
    if (typeof message === "string") this.guildQueues.delete(message);
    else if (message && message.guild) this.guildQueues.delete(message.guild.id);
  }

  /**
   * Get the guild queue
   * @param {Discord.Snowflake|Discord.Message} message The guild ID or message from guild channel.
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
    if (typeof message === "string") return this.guildQueues.get(message);
    if (!message || !message.guild) throw TypeError("Parameter should be Discord.Message or server ID!");
    return this.guildQueues.get(message.guild.id);
  }

  /**
   * Add a video to queue
   * @private
   * @ignore
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @param {Song} song Song to add
   * @throws {NotInVoice} if result is empty
   * @returns {Queue}
   */
  _addToQueue(message, song, unshift = false) {
    let queue = this.getQueue(message);
    if (!queue) return;
    if (!song) throw new Error("NoSong");
    if (unshift) {
      let playing = queue.songs.shift();
      queue.songs.unshift(playing, song);
    } else queue.songs.push(song);
    return queue;
  }

  /**
   * Add a array of videos to queue
   * @private
   * @ignore
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @param {Song[]} songs Array of song to add
   * @returns {Queue}
   */
  _addSongsToQueue(message, songs, unshift = false) {
    let queue = this.getQueue(message);
    if (!queue) return;
    if (!songs.length) throw new Error("NoSong");
    if (unshift) {
      let playing = queue.songs.shift();
      queue.songs.unshift(playing, ...songs);
    } else queue.songs.push(...songs);
    return queue;
  }

  /**
   * Pause the guild stream
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
    if (queue.dispatcher) try { queue.dispatcher.end() } catch { }
    if (this.options.leaveOnStop && queue.connection)
      try { queue.connection.channel.leave() } catch { }
    this._deleteQueue(message);
  }

  /**
   * Set the guild stream's volume
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
    else if (queue.repeatMode === mode) queue.repeatMode = 0;
    else queue.repeatMode = mode;
    return queue.repeatMode;
  }

  /**
   * Toggle autoplay mode
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
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
   * Whether or not a guild is playing music.
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel to check
   * @returns {boolean} Whether or not the guild is playing song(s)
   */
  isPlaying(message) {
    let queue = this.getQueue(message);
    return queue ? (queue.playing || !queue.pause) : false;
  }

  /**
   * Whether or not the guild queue is paused
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel to check
   * @returns {boolean} Whether or not the guild queue is paused
   */
  isPaused(message) {
    let queue = this.getQueue(message);
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
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Promise<Queue>} The guild queue
   */
  async runAutoplay(message) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    let song = queue.songs[0];
    if (!song.youtube) {
      // Search related
      let search = await this._searchSong(message, queue.songs[0].name, false, 1);
      search.type = "yt";

      queue.songs[0] = search;
      song = search;

      this.guildQueues.set(message.guild.id, queue);
      /*
	  this.emit("noRelated", message);
	  return queue;
	   */
    }
    let related = song.related;
    if (!related) {
      related = await ytdl.getBasicInfo(song.url, { requestOptions: this.requestOptions });
      related = related.related_videos;
    }
    related = related.filter(v => v.length_seconds != 'undefined')
    if (related && related[0])
      try {
        this._addToQueue(message, new Song(await ytdl.getBasicInfo(related[0].id, { requestOptions: this.requestOptions }), this.client.user, true));
      } catch { this.emit("noRelated", message) }
    else
      this.emit("noRelated", message);

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
    if (!Object.prototype.hasOwnProperty.call(ffmpegFilters, filter)) throw TypeError(filter + " is not a Filter (https://DisTube.js.org/global.html#Filter).");
    if (queue.filter == filter) queue.filter = null;
    else queue.filter = filter;
    this._playSong(message);
    if (!this.options.emitNewSongOnly) this.emit("playSong", message, queue, queue.songs[0]);
    return queue.filter;
  }

  /**
   * Emit error event
   * @private
   * @ignore
   */
  _emitError(message, error) {
    if (this.listeners("error").length)
      this.emit("error", message, error);
    else
      this.emit("error", error);
  }

  /**
   * Whether or not emit playSong event
   * @private
   * @ignore
   */
  _emitPlaySong(queue) {
    if (
      !this.options.emitNewSongOnly ||
      (
        queue.repeatMode !== 1 &&
        (!queue.songs[1] || queue.songs[0].id !== queue.songs[1].id)
      )
    ) return true;
    return false;
  }

  /**
   * Create a ytdl stream
   * @private
   * @ignore
   */
  async _createStream(queue) {
    let song = queue.songs[0];
    if (song.type === "spotify_track") {
      let search = await this._searchSong(message, song.name, false, 1);
      queue.songs[0] = search;
      song = search;

      this.guildQueues.set(message.guild.id, queue);
    }

    let encoderArgs = queue.filter ? ["-af", ffmpegFilters[queue.filter]] : null;
    let streamOptions = {
      opusEncoded: true,
      filter: (song.isLive ? "audioandvideo" : "audioonly"),
      quality: "highestaudio",
      highWaterMark: this.options.highWaterMark,
      requestOptions: this.requestOptions,
      encoderArgs,
    };
    if (song.youtube) return ytdl(song.url, streamOptions);
    return ytdl.arbitraryStream(song.streamURL, streamOptions);
  }

  /**
   * Play a song on voice connection
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   */
  _playSong(message) {
    let queue = this.getQueue(message);
    if (!queue) return;
    if (!queue.songs.length) return this._deleteQueue(message);
    try {
      queue.stream = this._createStream(queue).on("error", e => this._handlePlayingError(e, message, queue));

      queue.songs[0].start_time = moment().unix();
      this.guildQueues.set(message.guild.id, queue);

      queue.dispatcher = queue.connection.play(queue.stream, {
        highWaterMark: 1,
        type: 'opus',
        volume: queue.volume / 100,
        bitrate: 'auto'
      }).on("finish", () => this._handleSongFinish(message, queue))
        .on("error", () => { });
    } catch (e) {
      e.message = `Cannot play \`${queue.songs[0].id}\`: \`${e.message}\``;
      this._emitError(message, e);
    }
  }

  /**
   * Handle the queue when a Song finish
   * @private
   * @ignore
   */
  async _handleSongFinish(message, queue) {
    if (queue.stopped) return;
    if (this.options.leaveOnEmpty && this._isVoiceChannelEmpty(queue)) {
      this._deleteQueue(message);
      queue.connection.channel.leave();
      return this.emit("empty", message);
    }
    if (queue.repeatMode === 2 && !queue.skipped) queue.songs.push(queue.songs[0]);
    if (queue.songs.length <= 1 && (queue.skipped || !queue.repeatMode)) {
      if (queue.autoplay) await this.runAutoplay(message);
      if (queue.songs.length <= 1) {
        this._deleteQueue(message);
        if (this.options.leaveOnFinish && !queue.stopped)
          queue.connection.channel.leave();
        if (!queue.autoplay) this.emit("finish", message);
        return;
      }
    }
    queue.skipped = false;
    if (queue.repeatMode !== 1 || queue.skipped) queue.songs.shift();
    if (this._emitPlaySong(queue)) this.emit("playSong", message, queue, queue.songs[0]);
    if (queue.stream) queue.stream.destroy();
    return this._playSong(message);
  }

  /**
   * Handle error while playing Song
   * @private
   * @ignore
   */
  _handlePlayingError(e, message, queue) {
    e.message = "There is a problem while playing song!\n" + e.message;
    this._emitError(message, e);
    queue.songs.shift();
    if (queue.songs.length > 0) {
      this.emit("playSong", message, queue, queue.songs[0]);
      this._playSong(message);
    } else try { this.stop(message) } catch { this._deleteQueue(message) }
  }
}

module.exports = DisTube;

/**
 *  Emitted after DisTube add playlist to guild queue
 *
 * @event DisTube#addList
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {Playlist} playlist Playlist info
 * @since 1.1.0
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("addList", (message, queue, playlist) => message.channel.send(
 *     `Added \`${playlist.name}\` playlist (${playlist.songs.length} songs) to queue\n${status(queue)}`
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
 * @param {Playlist} playlist Playlist info
 * @param {Song} song Playing song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("playList", (message, queue, playlist, song) => message.channel.send(
 *     `Play \`${playlist.name}\` playlist (${playlist.songs.length} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
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
 * if song param of {@link DisTube#play|play()} is invalid url
 *
 * @event DisTube#searchResult
 * @param {Discord.Message} message The message from guild channel
 * @param {Song[]} result Searched result (max length = 12)
 * @example
 * // DisTubeOptions.searchSongs = true
 * distube.on("searchResult", (message, result) => {
 *     let i = 0;
 *     message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.name} - \`${song.formattedDuration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
 * });
 */
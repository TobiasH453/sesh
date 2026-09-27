# sesh

Omegle + TikTok for the crew. A private web app for you and ~20 friends:

- **Feed**: full-screen vertical clips. Swipe, double-tap to like, comment, share a link.
  *For you* is ranked, *Fresh* is newest first.
- **Post**: record straight from your camera (up to a minute) or upload a file.
- **Live**: random one-on-one video with whoever is on. Hit *Next* to skip. Text chat on the side,
  and five games you can start mid-call:
  - **Deep Thoughts**: a deck of questions for when the conversation stalls
  - **Would You Rather**: both pick in secret, then reveal. Tracks how in sync you are
  - **Tic-Tac-Toe**
  - **Quick Draw**: wait for green, tap first. Jump early and you lose the round. Rates your reaction time from "suspiciously sober" to "fried"
  - **Sketch**: co-op pictionary. One draws, the other guesses, swap each round
- **Me**: your clips, likes, game record, and the crew list showing who's around, looking, or in a call.

The feed also tells you when someone is looking for a sesh, so the two halves feed each other.

## Run it

Needs Node 22.13+ (it uses the built-in `node:sqlite`, so there's no database to set up).

```sh
npm install
SESH_CODE=pick-a-code npm start
```

Open http://localhost:3000, choose **Join**, and enter the invite code. Everything is stored in `./data`
(one SQLite file plus the uploaded clips).

## Getting friends on it

Browsers only allow camera access over **https** (localhost is the exception), so friends need an https URL.

**Quickest, from your own machine:** run a Cloudflare quick tunnel next to the server:

```sh
SESH_CODE=pick-a-code SECURE_COOKIES=1 npm start
cloudflared tunnel --url http://localhost:3000   # prints https://something.trycloudflare.com
```

Send that link and the invite code to the group chat. The URL changes each time you restart the tunnel;
a named tunnel or `tailscale funnel 3000` gives you a stable one.

**Always on:** deploy the Dockerfile anywhere that gives you https and a persistent disk (Fly.io, Railway,
a small VPS behind Caddy). Mount a volume at `/data`.

```sh
docker build -t sesh .
docker run -p 3000:3000 -v sesh-data:/data -e SESH_CODE=pick-a-code -e SECURE_COOKIES=1 sesh
```

## Config

| Env var | Default | What it does |
| --- | --- | --- |
| `SESH_CODE` | `puffpuffpass` | Invite code needed to create an account. Change it. |
| `PORT` | `3000` | |
| `DATA_DIR` | `./data` | Where the database and clips live. |
| `SECURE_COOKIES` | off | Set to `1` when served over https. |
| `MAX_UPLOAD_MB` | `200` | Largest clip you can upload. |
| `TRANSCODE` | on | If `ffmpeg` is installed, uploads are re-encoded to H.264 MP4 so every phone can play every clip (iPhone HEVC, Chrome WebM, etc). Set to `0` to skip. |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | none | A TURN server for live calls. See below. |

**About TURN:** live video is peer-to-peer. Most home Wi-Fi connects fine with just STUN, but some
networks (a lot of cellular, some dorm/office Wi-Fi) need a relay. If a call gets stuck on "Connecting",
add a TURN server. Metered and Cloudflare both have free tiers, or run `coturn` on a VPS.
`TURN_URL` takes a comma-separated list, e.g. `turn:turn.example.com:3478,turns:turn.example.com:5349`.

## The algorithm

It's twenty lines in `server/feed.js`. Each clip's score is its engagement (likes, comments, views)
divided by its age, boosted if you tend to like that person, lowered if it's your own, with a little noise so
the order shifts each time. Anything you've already watched goes behind everything you haven't, so the feed
only repeats once you've seen it all.

## Development

```sh
npm run dev    # restarts on server changes
npm test       # games, feed ranking, API, live matching, transcoding (skipped without ffmpeg)
```

No build step. The frontend is plain ES modules in `public/`.

```
server/
  index.js      http server, static files, media with range requests
  api.js        REST: auth, feed, clips, likes, comments, profiles
  live.js       websocket: presence, matchmaking queue, WebRTC signaling, game rooms
  feed.js       ranking
  media.js      upload streaming, optional ffmpeg transcode
  games/        server-side game logic, one file per game
public/
  js/views/     feed, live, post, profile, auth
  js/games/     game UIs, one file per game
  css/style.css
```

Adding a game means one file in `server/games/` (`create(ctx)` returning `move` and `view`) and one in
`public/js/games/` (`mount(root, { move })` returning `update`), then registering both in their `index.js`.

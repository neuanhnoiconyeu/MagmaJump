# MagmaJump

A small multiplayer arcade game built with browser canvas and Node's built-in HTTP server. There are no npm dependencies.

## Run it

Install Node.js 18 or newer, then from this folder run:

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). To play together on phones or computers on the same Wi-Fi, open `http://<host-computer-LAN-IP>:3000` on each device. The host computer's firewall must allow incoming connections on port 3000.

One player creates a room and shares its four-character code. Other players enter the code and a callsign. The host starts the round from the lobby. Rooms support up to eight players; the host can also start solo practice. The host can start another round after the crew returns to the lobby.

## Controls

- Tap, click, press Space, or press ↑ to flap.
- Use ← / → or A / D to steer. On touch screens, tap the left or right side to steer; swipe horizontally to change direction.
- Avoid the tower gates and stay above the rising lava. The live flight deck shows the room rankings.

## Notes

Room state lives in server memory, so restarting the Node process closes active rooms. Multiplayer updates use Server-Sent Events over HTTP and work across browser tabs and devices connected to the same server. For internet play, deploy the server somewhere reachable by all players and serve it over HTTPS.

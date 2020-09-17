const http = require('http')
const url = require('url')
// noinspection SpellCheckingInspection
const parsetorrent = require('parse-torrent')
// noinspection SpellCheckingInspection
const peerflix = require('peerflix')
const numeral = require('numeral')

const activeServers = {}

function createServer (opts) {
  const peerflixOpts = Object.assign({}, opts)
  delete peerflixOpts.port

  const server = http.createServer()

  server.on('request', function (request, response) {
    const host = new url.URL(`http://${request.headers.host}`).hostname || 'localhost'

    const error = (code, msg) => {
      response.statusCode = code
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.setHeader('Content-Length', Buffer.byteLength(msg))
      response.end(msg)
    }

    // Allow CORS requests to specify arbitrary headers, e.g. 'Range',
    // by responding to the OPTIONS preflight request with the specified
    // origin and requested headers.
    if (request.method === 'OPTIONS' && request.headers['access-control-request-headers']) {
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
      response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'])
      response.setHeader('Access-Control-Max-Age', '1728000')

      response.end()
      return
    }

    if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin)

    if (request.method === 'GET' && request.url === '/') {
      return error(404, 'Need torrent hash!')
    }

    if (request.method === 'GET') {
      if (request.url === '/status') {
        const bytes = function (num) {
          return numeral(num).format('0.0b')
        }

        let html = '<h1>Status</h1><ul>'
        for (const key in activeServers) {
          if (!Object.prototype.hasOwnProperty.apply(activeServers, key)) continue
          const engine = activeServers[key].peerflix
          html += `
            <li>
                <h3>${key}</h3>
                <dl>
                    <dt>Streamers:</dt>
                    <dd>${activeServers[key].connections}</dd>
                    
                    <dt>Speed:</dt>
                    <dd>&downarrow;${bytes(engine.swarm.downloadSpeed())}/s &uparrow;${bytes(engine.swarm.uploadSpeed())}/s</dd>
                    
                    <dt>Peers:</dt>
                    <dd>${engine.swarm.wires.filter(wire => !wire.peerChoking).length}/${engine.swarm.wires.length}</dd>
                </dl>
            </li>
          `
        }
        html += '</ul>'

        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.setHeader('Content-Length', Buffer.byteLength(html))
        response.end(html)
        return
      }

      parsetorrent.remote(request.url.slice(1), function (err, torrent) {
        if (err) {
          return error(400, err.message.toString())
        }
        let engine
        if (!(torrent.infoHash in activeServers)) {
          const shutdownServer = function () {
            engine.peerflix.remove(function () {
              delete activeServers[torrent.infoHash]
            })
          }

          engine = {
            connections: 0,
            peerflix: peerflix(torrent, peerflixOpts),
            timer: setTimeout(shutdownServer, 30000)
          }

          engine.peerflix.server.on('connection', function (socket) {
            engine.connections++
            if (engine.timer) {
              clearTimeout(engine.timer)
              delete engine.timer
            }
            engine.peerflix.server.index.select()
            socket.on('close', function () {
              engine.connections--
              if (engine.connections <= 0) {
                engine.timer = setTimeout(shutdownServer, 30000)
              }
            })
          })

          activeServers[torrent.infoHash] = engine
        } else {
          engine = activeServers[torrent.infoHash]
        }

        function onListening () {
          response.statusCode = 303
          response.setHeader('Location', `http://${host}:${engine.peerflix.server.address().port}`)
          const html = `Stream from <a href="http://${host}:${engine.peerflix.server.address().port}">http://${host}:${engine.peerflix.server.address().port}</a>`
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.setHeader('Content-Length', Buffer.byteLength(html))
          response.end(html)
        }

        if (!engine.peerflix.server.listening) {
          engine.peerflix.server.once('listening', onListening)
        } else {
          onListening()
        }
      })
      return
    }

    console.error(`unhandled url ${request.method} ${request.url}`)
    error(404, 'Sorry, this is not available')
  })

  return server
}

module.exports = function (opts) {
  if (!opts) opts = {}

  const server = createServer(opts)

  server.listen(opts.port || 0, opts.hostname)

  return server
}

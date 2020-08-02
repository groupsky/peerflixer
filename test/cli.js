/* eslint-env mocha */

const assert = require('assert')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')

const pkg = require('../package.json')

const cli = path.resolve(__dirname, '..', pkg.bin)

let proc

afterEach(async () => {
  if (proc) {
    if (!proc.kill()) {
      console.warn('regular kill didn\'t work, trying SIGKILL')
      if (!proc.kill('SIGKILL')) {
        console.error('can\'t kill the proc, need to use Ctrl+C')
      }
    }
  }
})

const run = async (params) => {
  proc = spawn(cli, params)
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (data) => {
      if (/Started listening/.test(data.toString())) {
        resolve()
      }
    })
    proc.on('exit', (code) => {
      reject(code)
    })
  })
}

const get = async (url) => {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let data = ''

      // A chunk of data has been recieved.
      response.on('data', (chunk) => {
        data += chunk
      })

      // The whole response has been received. Print out the result.
      response.on('end', () => {
        resolve({ response, data })
      })
    }).on('error', (err) => {
      reject(err)
    })
  })
}

describe('peerflixer:cli', () => {
  it('should listen on provided port', async () => {
    await run(['-p', '54321'])

    await assert.doesNotReject(get('http://localhost:54321'))
  })

  it('should redirect on opening torrent hash', async () => {
    await run()

    // sintel torrent - any other torrent would suffice as long as there are seeders
    const { response } = await get('http://localhost:8080/08ada5a7a6183aae1e09d831df6748d566095a10')

    assert.ok(response.headers.location)
  })

  it('should error on non torrent hash', async () => {
    await run()

    const { response } = await get('http://localhost:8080/IZZG2KNL4BKA7LYEKK5JAX6BQ27UV4QZKPL2JZQ')

    assert.strictEqual(response.statusCode, 400)
  })
})

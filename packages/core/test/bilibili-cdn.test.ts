import assert from 'node:assert/strict'

import { test, afterEach, vi } from 'vitest'
vi.mock('node-karin', () => ({ logger: new Proxy({}, { get: () => () => {} }) }))
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import axios from 'node-karin/axios'

import { Network } from '../src/module/utils/Network/Network'
import { createBilibiliCdnTools, streamUrls } from '../src/platform/bilibili/cdn'

const payload = Buffer.from('complete video/audio content'.repeat(100))
async function fixture() {
  const calls = []
  const server = http.createServer((req, res) => {
    calls.push([req.method, req.url, req.headers.range])
    if (req.url === '/bad') {
      res.writeHead(503)
      res.end()
      return
    }
    if (req.url === '/head404' && req.method === 'HEAD') {
      res.writeHead(404)
      res.end()
      return
    }
    if (req.url === '/unknown') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' })
      res.end()
      return
    }
    if (req.url === '/invalid206') {
      res.writeHead(206, { 'Content-Length': 1 })
      res.end('x')
      return
    }
    if (req.url === '/partial') {
      res.writeHead(200, { 'Content-Length': 100 })
      res.flushHeaders()
      res.write('broken')
      setTimeout(() => res.destroy(), 20)
      return
    }
    if (req.headers.range) {
      res.writeHead(206, { 'Content-Length': 1, 'Content-Range': `bytes 0-0/${payload.length}` })
      res.end(payload.subarray(0, 1))
    } else {
      res.writeHead(200, { 'Content-Length': payload.length })
      res.end(payload)
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kkk-cdn-test-'))
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const downloads = []
  const realDownload = (url, options) =>
    new Network({
      url,
      headers: options.headers,
      filepath: options.filepath,
      maxRetries: options.maxRetries,
      timeout: 2000
    }).downloadStream()
  const tools = createBilibiliCdnTools({
    request: (options) => axios.request({ ...options, proxy: false }),
    downloadFile: async (url, options) => {
      downloads.push([url, options])
      return realDownload(url, options)
    },
    resolvePath: (options) => path.join(dir, options.title),
    logger: { warn() {} }
  })
  return { tools, url: `http://127.0.0.1:${server.address().port}`, dir, calls, downloads }
}

test('normalizes and deduplicates both API field spellings', () => {
  assert.deepEqual(
    streamUrls({
      base_url: 'https://a/v',
      baseUrl: 'https://a/v',
      backup_url: ['https://b/v', null],
      backupUrl: ['https://c/v', 'file:///etc/passwd']
    }),
    ['https://a/v', 'https://b/v', 'https://c/v']
  )
})
test('HEAD 404 falls back to one byte GET and reports full size', async () => {
  const f = await fixture()
  assert.equal(await f.tools.size({ base_url: f.url + '/head404' }, {}), payload.length)
  assert.deepEqual(f.calls, [
    ['HEAD', '/head404', undefined],
    ['GET', '/head404', 'bytes=0-0']
  ])
})
test('refused primary uses backup and reuses it for download', async () => {
  const f = await fixture()
  const closed = http.createServer()
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve))
  const port = closed.address().port
  await new Promise((resolve) => closed.close(resolve))
  const track = { baseUrl: `http://127.0.0.1:${port}/refused`, backupUrl: [f.url + '/good'] }
  assert.equal(await f.tools.size(track, {}), payload.length)
  const result = await f.tools.download(track, { title: 'audio.m4s' })
  assert.deepEqual(fs.readFileSync(result.filepath), payload)
  assert.equal(f.downloads[0][0], f.url + '/good')
  assert.equal(f.downloads[0][1].maxRetries, 0)
})
test('failed partial download switches source without mixing files', async () => {
  const f = await fixture()
  const result = await f.tools.download({ base_url: f.url + '/partial', backup_url: [f.url + '/good'] }, { title: 'video.m4s' })
  assert.deepEqual(fs.readFileSync(result.filepath), payload)
  assert.equal(f.downloads.length, 2)
  assert.notEqual(f.downloads[0][1].filepath, f.downloads[1][1].filepath)
  assert.deepEqual(fs.readdirSync(f.dir), ['video.m4s'])
})
test('all sources failing preserves existing output and cleans partial files', async () => {
  const f = await fixture()
  fs.writeFileSync(path.join(f.dir, 'video.m4s'), 'existing')
  await assert.rejects(
    f.tools.download({ base_url: f.url + '/partial', backup_url: [f.url + '/bad'] }, { title: 'video.m4s' }),
    /已尝试 2 个地址/
  )
  assert.equal(fs.readFileSync(path.join(f.dir, 'video.m4s'), 'utf8'), 'existing')
  assert.deepEqual(fs.readdirSync(f.dir), ['video.m4s'])
})
test('unknown size and incomplete 206 length never become zero or one byte size', async () => {
  const f = await fixture()
  await assert.rejects(f.tools.size({ base_url: f.url + '/unknown', backup_url: [f.url + '/invalid206'] }, {}), /无法获取文件大小/)
})

test('PCDN primary defers to regular CDN while preserving every fallback', () => {
  assert.deepEqual(
    streamUrls({ base_url: 'https://xy.mcdn.bilivideo.cn/v', backup_url: ['https://other.example/v', 'https://cn.bilivideo.com/v'] }),
    ['https://cn.bilivideo.com/v', 'https://other.example/v', 'https://xy.mcdn.bilivideo.cn/v']
  )
})

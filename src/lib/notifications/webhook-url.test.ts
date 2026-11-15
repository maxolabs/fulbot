import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkWebhookUrl, isPublicIpAddress } from './webhook-url'

test('private, loopback, link-local and metadata addresses are not public', () => {
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fd00:ec2::254', 'fc00::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::127.0.0.1',
    '64:ff9b::10.0.0.1', '2002:0a00:0001::1', '[::1]',
  ]) {
    assert.equal(isPublicIpAddress(address), false, address)
  }
})

test('ordinary public addresses pass', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicIpAddress(address), true, address)
  }
})

test('webhook URL must be https to a public host', () => {
  assert.equal(checkWebhookUrl('https://hooks.example.com/whatsapp'), null)
  assert.equal(checkWebhookUrl('http://hooks.example.com/whatsapp'), 'https')
  assert.equal(checkWebhookUrl('not a url'), 'invalid')
  assert.equal(checkWebhookUrl('https://user:pass@hooks.example.com/'), 'credentials')
  assert.equal(checkWebhookUrl('https://localhost:3000/'), 'host')
  assert.equal(checkWebhookUrl('https://metadata.google.internal/'), 'host')
  assert.equal(checkWebhookUrl('https://169.254.169.254/latest'), 'host')
  assert.equal(checkWebhookUrl('https://[::1]/'), 'host')
  assert.equal(checkWebhookUrl('https://router/'), 'host')
})

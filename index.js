'use strict'

const reachableUrl = require('reachable-url')
const isRedirect = require('is-redirect')
const dnsErrors = require('dnserrors')
const timeSpan = require('time-span')
const pick = require('lodash.pick')
const aigle = require('aigle')
const mitt = require('mitt')

const RESPONSE_PROPS = ['redirectUrls', 'url', 'requestUrl', 'statusCode']

const getStatusByGroup = statusCode => `${String(statusCode).charAt(0)}xx`

const fetch = async (targetUrl, opts) => {
  let res
  let timestamp
  let statusCode

  try {
    timestamp = timeSpan()
    res = await reachableUrl(targetUrl, { ...opts, followRedirect: false })
    timestamp = timestamp()
    statusCode = res.statusCode
    if (!isRedirect(statusCode)) {
      return { ...pick(res, RESPONSE_PROPS), timestamp }
    }

    timestamp = timeSpan()
    res = await reachableUrl(targetUrl, opts)
    timestamp = timestamp()
    return {
      ...pick(res, RESPONSE_PROPS),
      redirectStatusCode: statusCode,
      timestamp
    }
  } catch (aggregatedError) {
    timestamp = timestamp()
    const errors = Array.from(aggregatedError)
    const { statusCode = 500, url } = errors
      .map(dnsErrors)
      .find(error => !!error.url)

    return {
      url,
      timestamp,
      requestUrl: url,
      redirectUrls: [],
      statusCode: statusCode
    }
  }
}

module.exports = async (urls, { concurrence = 8, ...opts } = {}) => {
  const emitter = mitt()

  async function iterator (acc, targetUrl) {
    emitter.emit('fetching', { url: targetUrl })
    const res = await fetch(targetUrl, opts)
    const statusCodeGroup = getStatusByGroup(
      res.redirectStatusCode || res.statusCode
    )
    const data = { ...res, statusCodeGroup }

    emitter.emit('status', data)
    if (!acc[statusCodeGroup]) acc[statusCodeGroup] = [data]
    else acc[statusCodeGroup].push(data)
  }

  aigle
    .transformLimit(urls, concurrence, iterator, {})
    .then(data => emitter.emit('end', data))

  return emitter
}
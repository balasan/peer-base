/* eslint-env mocha */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
const expect = chai.expect

const PeerBase = require('../')
const AppFactory = require('./utils/create-app')
const Repo = require('./utils/repo')
const waitForMembers = require('./utils/wait-for-members')
const waitForValue = require('./utils/wait-for-value')

describe('pinner', function () {
  this.timeout(60000)

  const collaborationName = 'pinner test collab'
  const peerCount = 2 // 10
  const collaborationOptions = {
    debouncePushMS: 100,
    debouncePushToPinnerMS: 1000,
    debouncePushMaxMS: 200,
    debouncePushToPinnerMaxMS: 2000
  }

  let appName
  let App
  let swarm = []
  let pinner
  let collaborations
  let newReader
  let newReaderCollab
  let expectedValue

  before(() => {
    appName = AppFactory.createName()
    App = AppFactory(appName)
  })

  const peerIndexes = []
  for (let i = 0; i < peerCount; i++) {
    peerIndexes.push(i)
  }

  before(() => Promise.all(peerIndexes.map(() => {
    const app = App({ maxThrottleDelayMS: 100 })
    swarm.push(app)
    return app.start()
  })))

  before(async () => {
    collaborationOptions.keys = await PeerBase.keys.generate()
  })

  before(async () => {
    collaborations = await Promise.all(
      swarm.map((peer) => peer.app.collaborate(collaborationName, 'gset', collaborationOptions)))
    expect(collaborations.length).to.equal(peerCount)
    await waitForMembers(collaborations)
  })

  it('can add a pinner to a collaboration', (done) => {
    pinner = PeerBase.createPinner(appName, {
      ipfs: {
        swarm: AppFactory.swarm,
        repo: Repo(),
        init: App.init()
      }
    })

    pinner.start().then(() => {
      pinner.once('collaboration started', (collaboration) => {
        expect(collaboration.name).to.equal(collaborationName)
        done()
      })
    })
  })

  it('waits for the pinner to be a part of the membership', async () => {
    await waitForMembers(collaborations.concat(await pinner.peerId()))
  })

  it('peers can perform mutations', (done) => {
    let count = 0
    const check = () => ++count === 2 && done()
    collaborations.forEach((collaboration, idx) => {
      collaboration.replication.once('pinned', check)
      collaboration.shared.add(idx)
    })
  })

  it('converges between replicas', () => {
    expectedValue = new Set([...peerIndexes])
    return waitForValue(collaborations, expectedValue)
  })

  it('waits for pinned event', (done) => {
    let pinned = false

    collaborations.forEach((collaboration) => {
      collaboration.replication.once('pinned', () => {
        if (!pinned) {
          pinned = true
          done()
        }
      })
    })

    collaborations.forEach((collaboration, idx) => {
      collaboration.shared.add(idx)
    })
  })

  it('stops all replicas except for pinner', () => {
    return Promise.all(swarm.map(peer => peer.stop()))
  })

  it('can start new reader', async () => {
    newReader = App({ maxThrottleDelayMS: 100 })
    await newReader.start()
    newReaderCollab = await newReader.app.collaborate(collaborationName, 'gset', collaborationOptions)
  })

  it('new reader has pinner', async () => waitForMembers([newReaderCollab, await pinner.peerId()]))

  it('new reader got state', () => waitForValue(newReaderCollab, expectedValue))

  it('can stop new reader', () => {
    return newReader.stop()
  })

  it('can stop pinner', () => {
    return pinner.stop()
  })
})

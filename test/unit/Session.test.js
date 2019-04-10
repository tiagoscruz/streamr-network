import assert from 'assert'
import sinon from 'sinon'
import StreamrClient from '../../src'
import config from '../integration/config'
import Session from './../../src/Session'

describe('Session', () => {
    let session
    let msg
    let clientSessionToken
    let clientNone

    const createClient = (opts = {}) => new StreamrClient({
        url: config.websocketUrl,
        restUrl: config.restUrl,
        autoConnect: false,
        autoDisconnect: false,
        ...opts,
    })

    beforeEach(() => {
        clientSessionToken = createClient({
            auth: {
                sessionToken: 'session-token',
            },
        })
        clientSessionToken.logoutEndpoint = sinon.stub().resolves()
        clientNone = createClient({
            auth: {},
        })
    })

    beforeEach(() => {
        session = new Session(clientSessionToken)
        session.options.unauthenticated = false
        session.loginFunction = sinon.stub()
        session.loginFunction.onCall(0).resolves({
            token: 'session-token1',
        })
        session.loginFunction.onCall(1).resolves({
            token: 'session-token2',
        })
    })

    describe('instantiation', () => {
        it('should get token if set with a token', () => clientSessionToken.session.getSessionToken()
            .then((sessionToken) => {
                assert.strictEqual(sessionToken, clientSessionToken.session.options.sessionToken)
            }))
        it('should return undefined with no authentication', () => clientNone.session.getSessionToken()
            .then((sessionToken) => {
                assert.strictEqual(sessionToken, undefined)
            }))
        it('login function should throw if only session token provided', (done) => clientSessionToken.session.loginFunction()
            .catch((err) => {
                assert.equal(
                    err.toString(),
                    'Error: Need either "privateKey", "provider", "apiKey", "username"+"password" or "sessionToken" to login.',
                )
                done()
            }))
        it('login function should throw if no authentication', (done) => clientNone.session.loginFunction()
            .catch((err) => {
                assert.equal(
                    err.toString(),
                    'Error: Need either "privateKey", "provider", "apiKey", "username"+"password" or "sessionToken" to login.',
                )
                done()
            }))
    })

    describe('getSessionToken', () => {
        it('should set sessionToken', async () => {
            await session.getSessionToken()
            assert(session.loginFunction.calledOnce)
            assert(session.options.sessionToken === 'session-token1')
        })
        it('should not call loginFunction if token set', async () => {
            session.options.sessionToken = 'session-token1'
            await session.getSessionToken()
            assert(session.loginFunction.notCalled)
        })
        it('should call loginFunction if new token required', async () => {
            session.options.sessionToken = 'expired-session-token'
            await session.getSessionToken(true)
            assert(session.loginFunction.calledOnce)
            assert(session.options.sessionToken === 'session-token1')
        })
    })

    describe('Internal state', () => {
        describe('loginFunction resolves', () => {
            it('should return same value when calling getSessionToken() twice while logging in', () => {
                const p1 = session.getSessionToken()
                const p2 = session.getSessionToken()
                return Promise.all([p1, p2]).then(([sessionToken1, sessionToken2]) => {
                    assert(session.loginFunction.calledOnce)
                    assert.equal(sessionToken1, sessionToken2)
                })
            })
            it('should return different values when retrieving fresh session tokens twice sequentially', async () => {
                const sessionToken1 = await session.getSessionToken(true)
                const sessionToken2 = await session.getSessionToken(true)
                assert.notStrictEqual(sessionToken1, sessionToken2)
            })
        })
        describe('loginFunction rejects', () => {
            beforeEach(() => {
                session = new Session()
                session.options.unauthenticated = false
                msg = 'Error: Need either "privateKey", "provider", "apiKey" or "username"+"password" to login.'
                session.loginFunction = sinon.stub().rejects(msg)
            })
            it('should fail both requests with one call to loginFunction', (done) => {
                const p1 = session.getSessionToken()
                const p2 = session.getSessionToken()
                p1.catch((err) => {
                    assert.equal(err.toString(), msg)
                })
                p2.catch((err) => {
                    assert.equal(err.toString(), msg)
                    assert(session.loginFunction.calledOnce)
                    done()
                })
            })
            it('should fail both requests with two calls to loginFunction', (done) => {
                const p1 = session.getSessionToken()
                p1.catch((err) => {
                    assert.equal(err.toString(), msg)
                    const p2 = session.getSessionToken()
                    p2.catch((err2) => {
                        assert.equal(err2.toString(), msg)
                        assert(session.loginFunction.calledTwice)
                        done()
                    })
                })
            })
        })
    })

    describe('logout', () => {
        it('should call the logout endpoint', async () => {
            await session.getSessionToken()
            await session.logout()
            assert(clientSessionToken.logoutEndpoint.calledOnce)
        })
        it('should call the logout endpoint again', async () => {
            await session.getSessionToken()
            await session.logout()
            await session.getSessionToken()
            await session.logout()
            assert(clientSessionToken.logoutEndpoint.calledTwice)
        })
        it('should throw if already logging out', async (done) => {
            await session.getSessionToken()
            session.logout()
            session.logout().catch((err) => {
                assert.strictEqual(err.toString(), 'Error: Already logging out!')
                done()
            })
        })
        it('should throw if already logged out', async (done) => {
            await session.getSessionToken()
            await session.logout()
            session.logout().catch((err) => {
                assert.strictEqual(err.toString(), 'Error: Already logged out!')
                done()
            })
        })
        it('can logout while logging in', (done) => {
            session.once('logging in', async () => {
                await session.logout()
                done()
            })
            session.getSessionToken()
        })
        it('can login while logging out', async (done) => {
            session.once('logging out', async () => {
                await session.getSessionToken()
                done()
            })
            await session.getSessionToken()
            session.logout()
        })
    })
})

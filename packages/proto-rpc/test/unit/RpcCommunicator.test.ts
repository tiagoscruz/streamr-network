import { RpcCommunicator } from '../../src/RpcCommunicator'
import {
    RpcMessage,
    RpcResponseError
} from '../../src/proto/ProtoRpc'
import { PingRequest, PingResponse } from '../proto/TestProtos' 
import { ResultParts } from '../../src/ClientTransport'
import { Deferred, RpcMetadata, RpcStatus } from '@protobuf-ts/runtime-rpc'
import * as Err from '../../src/errors'
import { MockDhtRpc, clearMockTimeouts } from '../utils'
import { ProtoCallContext } from '../../src/ProtoCallContext'
import { waitForCondition } from '@streamr/utils'

describe('RpcCommunicator', () => {
    let rpcCommunicator: RpcCommunicator

    let promises: ResultParts
    let request: RpcMessage
    let responseRpcMessage: RpcMessage

    beforeEach(() => {
        rpcCommunicator = new RpcCommunicator({ rpcRequestTimeout: 1000 })
        
        const deferredParser = (bytes: Uint8Array) => PingResponse.fromBinary(bytes)
        promises = {
            header: new Deferred<RpcMetadata>(),
            message: new Deferred<PingResponse>(),
            status: new Deferred<RpcStatus>(),
            trailer: new Deferred<RpcMetadata>(),
            messageParser: deferredParser
        }
        request = {
            requestId: 'message',
            header: {
                method: 'ping',
                request: 'request',
            },
            body: PingRequest.toBinary({ requestId: 'requestId' })
        }
        responseRpcMessage = {
            requestId: 'message',
            header: {
                method: 'ping',
                response: 'response',
            },
            body: PingResponse.toBinary({ requestId: 'requestId' }),
        }
        /*
        response = {
            appId: appId,
            messageId: 'aaaa',
            body: RpcMessage.toBinary(responseRpcMessage),
            messageType: MessageType.RPC
        } */ 
    })

    afterEach(() => {
        rpcCommunicator.stop()
    })

    afterAll(() => {
        clearMockTimeouts()
    })

    it('Resolves Promises', async () => {
        // @ts-expect-error private 
        rpcCommunicator.onOutgoingMessage(request, promises)
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(responseRpcMessage))
        const pong = await promises.message.promise
        expect(pong).toEqual({ requestId: 'requestId' })
    })

    it('Timeouts Promises', async () => {
        // @ts-expect-error private 
        rpcCommunicator.onOutgoingMessage(request, promises)
        await expect(promises.message.promise)
            .rejects
            .toEqual(new Err.RpcTimeout('Rpc request timed out'))
    })

    it('Rejects on error response', async () => {
        const errorResponse: RpcMessage = {
            ...responseRpcMessage,
            responseError: RpcResponseError.SERVER_ERROR
        }
        //response.body = RpcMessage.toBinary(errorResponse)
        // @ts-expect-error private 
        rpcCommunicator.onOutgoingMessage(request, promises)
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(errorResponse))
        await expect(promises.message.promise)
            .rejects
            .toEqual(new Err.RpcRequest('Server error on request'))
    })

    it('Rejects on server timeout response', async () => {
        const errorResponse: RpcMessage = {
            ...responseRpcMessage,
            responseError: RpcResponseError.SERVER_TIMOUT
        }
        //response.body = RpcMessage.toBinary(errorResponse)
        // @ts-expect-error private 
        rpcCommunicator.onOutgoingMessage(request, promises)
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(errorResponse))
        await expect(promises.message.promise)
            .rejects
            .toEqual(new Err.RpcRequest('Server timed out on request'))
    })

    it('Rejects on unknown method', async () => {
        const errorResponse: RpcMessage = {
            ...responseRpcMessage,
            responseError: RpcResponseError.UNKNOWN_RPC_METHOD
        }
        //response.body = RpcMessage.toBinary(errorResponse)
        // @ts-expect-error private 
        rpcCommunicator.onOutgoingMessage(request, promises)
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(errorResponse))
        await expect(promises.message.promise)
            .rejects
            .toEqual(new Err.RpcRequest(`Server does not implement method ping`))
    })

    it('Success responses to requests', async () => {
        let successCounter = 0
        rpcCommunicator.registerRpcMethod(PingRequest, PingResponse, 'ping', MockDhtRpc.ping)
        rpcCommunicator.on('outgoingMessage', (message: Uint8Array, _ucallContext?: ProtoCallContext) => {
            const pongWrapper = RpcMessage.fromBinary(message)
            if (!pongWrapper.responseError) {
                successCounter += 1
            }
        })
        
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(request))
        await waitForCondition(() => successCounter === 1)
    })

    it('Success responses to new registration method', async () => {
        let successCounter = 0
        rpcCommunicator.registerRpcMethod(PingRequest, PingResponse, 'ping', MockDhtRpc.ping)
        rpcCommunicator.on('outgoingMessage', (message: Uint8Array, _ucallContext?: ProtoCallContext) => {
            const pongWrapper = RpcMessage.fromBinary(message)
            if (!pongWrapper.responseError) {
                successCounter += 1
            }
        })
        
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(request), new ProtoCallContext())
        await waitForCondition(() => successCounter === 1)
    })

    it('Error response on unknown method', async () => {
        let errorCounter = 0
        rpcCommunicator.on('outgoingMessage', (message: Uint8Array, _ucallContext?: ProtoCallContext) => {
            const pongWrapper = RpcMessage.fromBinary(message)
            if (pongWrapper.responseError && pongWrapper.responseError === RpcResponseError.UNKNOWN_RPC_METHOD) {
                errorCounter += 1
            }
        })
       
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(request))
        await waitForCondition(() => errorCounter === 1)
    })

    it('Error response on server timeout', async () => {
        let errorCounter = 0

        rpcCommunicator.registerRpcMethod(PingRequest, PingResponse, 'ping', MockDhtRpc.respondPingWithTimeout)
        rpcCommunicator.on('outgoingMessage', (message: Uint8Array, _ucallContext?: ProtoCallContext) => {
            const pongWrapper = RpcMessage.fromBinary(message)
            if (pongWrapper.responseError !== undefined && pongWrapper.responseError === RpcResponseError.SERVER_TIMOUT as RpcResponseError) {
                errorCounter += 1
            }
        })
       
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(request))
        await waitForCondition(() => errorCounter === 1)
    })

    it('Error response on server timeout', async () => {
        let errorCounter = 0
        rpcCommunicator.registerRpcMethod(PingRequest, PingResponse, 'ping', MockDhtRpc.throwPingError)
        rpcCommunicator.on('outgoingMessage', (message: Uint8Array, _ucallContext?: ProtoCallContext) => {
            const pongWrapper = RpcMessage.fromBinary(message)
            if (pongWrapper.responseError !== undefined && pongWrapper.responseError === RpcResponseError.SERVER_ERROR) {
                errorCounter += 1
            }
        })
       
        rpcCommunicator.handleIncomingMessage(RpcMessage.toBinary(request))
        await waitForCondition(() => errorCounter === 1)
    })
})

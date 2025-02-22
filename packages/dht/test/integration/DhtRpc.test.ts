import { getMockPeers, MockDhtRpc } from '../utils'
import { ProtoRpcClient, RpcCommunicator, RpcError, toProtoRpcClient } from '@streamr/proto-rpc'
import { DhtRpcServiceClient } from '../../src/proto/DhtRpc.client'
import { generateId } from '../utils'
import { ClosestPeersRequest, ClosestPeersResponse, PeerDescriptor } from '../../src/proto/DhtRpc'
import { wait } from '@streamr/utils'
import { ServerCallContext } from '@protobuf-ts/runtime-rpc'
import { DhtCallContext } from '../../src/rpc-protocol/DhtCallContext'

describe('DhtRpc', () => {
    let rpcCommunicator1: RpcCommunicator
    let rpcCommunicator2: RpcCommunicator
    let client1: ProtoRpcClient<DhtRpcServiceClient>
    let client2: ProtoRpcClient<DhtRpcServiceClient>

    const peerDescriptor1: PeerDescriptor = {
        peerId: generateId('peer1'),
        type: 0
    }

    const peerDescriptor2: PeerDescriptor = {
        peerId: generateId('peer2'),
        type: 0
    }

    const outgoingListener2 = (message: Uint8Array, _ucallContext?: DhtCallContext) => {
        rpcCommunicator1.handleIncomingMessage(message)
    }

    beforeEach(() => {
        rpcCommunicator1 = new RpcCommunicator()
        rpcCommunicator1.registerRpcMethod(ClosestPeersRequest, ClosestPeersResponse, 'getClosestPeers', MockDhtRpc.getClosestPeers)

        rpcCommunicator2 = new RpcCommunicator()
        rpcCommunicator2.registerRpcMethod(ClosestPeersRequest, ClosestPeersResponse, 'getClosestPeers', MockDhtRpc.getClosestPeers)

        rpcCommunicator1.on('outgoingMessage', (message: Uint8Array, _ucallContext?: DhtCallContext) => {
            rpcCommunicator2.handleIncomingMessage(message)
        })

        rpcCommunicator2.on('outgoingMessage', outgoingListener2)

        client1 = toProtoRpcClient(new DhtRpcServiceClient(rpcCommunicator1.getRpcClientTransport()))
        client2 = toProtoRpcClient(new DhtRpcServiceClient(rpcCommunicator1.getRpcClientTransport()))
    })

    afterEach(async () => {
        await rpcCommunicator1.stop()
        await rpcCommunicator2.stop()
    })

    it('Happy path', async () => {
        const response1 = client1.getClosestPeers(
            { peerDescriptor: peerDescriptor1, requestId: '1' },
            { targetDescriptor: peerDescriptor2 }
        )
        const res1 = await response1
        expect(res1.peers).toEqual(getMockPeers())

        const response2 = client2.getClosestPeers(
            { peerDescriptor: peerDescriptor2, requestId: '1' },
            { targetDescriptor: peerDescriptor1 }
        )
        const res2 = await response2
        expect(res2.peers).toEqual(getMockPeers())
    })

    it('Default RPC timeout, client side', async () => {
        rpcCommunicator2.off('outgoingMessage', outgoingListener2)
        rpcCommunicator2.on('outgoingMessage', async (_umessage: Uint8Array, _ucallContext?: DhtCallContext) => {
            await wait(3000)
        })
        const response2 = client2.getClosestPeers(
            { peerDescriptor: peerDescriptor2, requestId: '1' },
            { targetDescriptor: peerDescriptor1 }
        )
        await expect(response2).rejects.toEqual(
            new RpcError.RpcTimeout('Rpc request timed out')
        )
    }, 15000)

    it('Server side timeout', async () => {
        let timeout: NodeJS.Timeout
        
        function respondGetClosestPeersWithTimeout(_request: ClosestPeersRequest, _context: ServerCallContext): Promise<ClosestPeersResponse> {
            const neighbors = getMockPeers()
            const response: ClosestPeersResponse = {
                peers: neighbors,
                requestId: 'why am i still here'
            }
            return new Promise((resolve, _reject) => {
                timeout = setTimeout(() => {
                    resolve(response)
                }, 5000)
            })
        }
        
        rpcCommunicator2.registerRpcMethod(ClosestPeersRequest, ClosestPeersResponse, 'getClosestPeers', respondGetClosestPeersWithTimeout)
        const response = client2.getClosestPeers(
            { peerDescriptor: peerDescriptor2, requestId: '1' },
            { targetDescriptor: peerDescriptor1 }
        )
        await expect(response).rejects.toEqual(
            new RpcError.RpcTimeout('Server timed out on request')
        )
        clearTimeout(timeout!)
    })

    it('Server responds with error on unknown method', async () => {
        const response = client2.ping(
            { requestId: '1' },
            { targetDescriptor: peerDescriptor1 }
        )
        await expect(response).rejects.toEqual(
            new RpcError.UnknownRpcMethod('Server does not implement method ping')
        )
    })
})

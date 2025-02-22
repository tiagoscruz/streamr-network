import { Event as wrtcEvent } from '../../src/connection/webrtc/IWebRtcEndpoint'
import { PeerInfo, PeerType } from '../../src/connection/PeerInfo'
import { MetricsContext } from '@streamr/utils'
import { RtcSignaller } from '../../src/logic/RtcSignaller'
import { Tracker } from '@streamr/network-tracker'
import { NodeToTracker } from '../../src/protocol/NodeToTracker'
import { NegotiatedProtocolVersions } from "../../src/connection/NegotiatedProtocolVersions"
import { Event as ntnEvent, NodeToNode } from "../../src/protocol/NodeToNode"
import { MessageID, StreamMessage, toStreamID } from "@streamr/protocol"
import { runAndWaitForEvents } from '@streamr/test-utils'
import { WebRtcEndpoint } from '../../src/connection/webrtc/WebRtcEndpoint'
import { webRtcConnectionFactory } from '../../src/connection/webrtc/NodeWebRtcConnection'
import { toEthereumAddress } from '@streamr/utils'
import { createTestNodeClientWsEndpoint, createTestWebRtcEndpoint, startTestTracker } from '../utils'

const PUBLISHER_ID = toEthereumAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

describe('Node-to-Node protocol version negotiation', () => {
    let tracker: Tracker
    let nodeToTracker1: NodeToTracker
    let nodeToTracker2: NodeToTracker
    let nodeToTracker3: NodeToTracker
    let ep1: WebRtcEndpoint
    let ep2: WebRtcEndpoint
    let ep3: WebRtcEndpoint
    let nodeToNode1: NodeToNode
    let nodeToNode2: NodeToNode

    beforeEach(async () => {
        tracker = await startTestTracker({
            port: 28680
        })

        const peerInfo1 = new PeerInfo('node-endpoint1', PeerType.Node, [1, 2, 3], [29, 30, 31, 32])
        const peerInfo2 = new PeerInfo('node-endpoint2', PeerType.Node, [1, 2], [31, 32, 33])
        const peerInfo3 = new PeerInfo('node-endpoint3', PeerType.Node, [1, 2], [33])
        const trackerPeerInfo = PeerInfo.newTracker(tracker.getTrackerId())
        // Need to set up NodeToTrackers and WsEndpoint(s) to exchange RelayMessage(s) via tracker
        const wsEp1 = createTestNodeClientWsEndpoint(peerInfo1)
        const wsEp2 = createTestNodeClientWsEndpoint(peerInfo2)
        const wsEp3 = createTestNodeClientWsEndpoint(peerInfo3)
        nodeToTracker1 = new NodeToTracker(wsEp1)
        nodeToTracker2 = new NodeToTracker(wsEp2)
        nodeToTracker3 = new NodeToTracker(wsEp3)

        await nodeToTracker1.connectToTracker(tracker.getUrl(), trackerPeerInfo)
        await nodeToTracker2.connectToTracker(tracker.getUrl(), trackerPeerInfo)
        await nodeToTracker3.connectToTracker(tracker.getUrl(), trackerPeerInfo)

        // Set up WebRTC endpoints
        ep1 = createTestWebRtcEndpoint(
            peerInfo1,
            [],
            new RtcSignaller(peerInfo1, nodeToTracker1),
            new MetricsContext(),
            new NegotiatedProtocolVersions(peerInfo1),
            webRtcConnectionFactory,
            5000
        )
        ep2 = createTestWebRtcEndpoint(
            peerInfo2,
            [],
            new RtcSignaller(peerInfo2, nodeToTracker2),
            new MetricsContext(),
            new NegotiatedProtocolVersions(peerInfo2),
            webRtcConnectionFactory,
            5000
        )
        ep3 = createTestWebRtcEndpoint(
            peerInfo3,
            [],
            new RtcSignaller(peerInfo3, nodeToTracker3),
            new MetricsContext(),
            new NegotiatedProtocolVersions(peerInfo3),
            webRtcConnectionFactory,
            5000
        )
        nodeToNode1 = new NodeToNode(ep1)
        nodeToNode2 = new NodeToNode(ep2)

        await runAndWaitForEvents(()=> {nodeToNode1.connectToNode('node-endpoint2', tracker.getTrackerId())}, [
            [nodeToNode1, ntnEvent.NODE_CONNECTED],
            [nodeToNode2, ntnEvent.NODE_CONNECTED]
        ])
    })

    afterEach(async () => {
        await Promise.allSettled([
            tracker.stop(),
            nodeToTracker1.stop(),
            nodeToTracker2.stop(),
            nodeToTracker3.stop(),
            ep1.stop(),
            ep2.stop(),
            ep3.stop()
        ])
    })
    
    it('protocol versions are correctly negotiated',  () => {
        expect(nodeToNode1.getNegotiatedProtocolVersionsOnNode('node-endpoint2')).toEqual([2, 32])
        expect(nodeToNode2.getNegotiatedProtocolVersionsOnNode('node-endpoint1')).toEqual([2, 32])
    })

    it('messages are sent with the negotiated protocol version', (done) => {
        ep2.once(wrtcEvent.MESSAGE_RECEIVED, (_peerInfo, data) => {
            const parsedData = JSON.parse(data)
            expect(parsedData[0]).toEqual(2)
            expect(parsedData[3][0]).toEqual(32)
            done()
        })
        const i = 1
        const msg1 = new StreamMessage({
            messageId: new MessageID(toStreamID('stream-1'), 0, i, 0, PUBLISHER_ID, 'msgChainId'),
            prevMsgRef: null,
            content: {
                messageNo: i
            },
            signature: 'signature'
        })
        nodeToNode1.sendData('node-endpoint2', msg1)
    })
    
    it('negotiated version is removed once node is disconnected', async () => {
        await runAndWaitForEvents(()=> { ep1.close('node-endpoint2', 'test') }, [ep2, wrtcEvent.PEER_DISCONNECTED])

        expect(ep1.getNegotiatedControlLayerProtocolVersionOnNode('node-endpoint2')).toEqual(undefined)
        expect(ep2.getNegotiatedControlLayerProtocolVersionOnNode('node-endpoint1')).toEqual(undefined)
    })
    
    it('if there are no shared versions the connection is closed', async () => {
        let errors = 0
        try {
            await Promise.all([
                ep3.connect('node-endpoint1', tracker.getTrackerId()),
                ep1.connect('node-endpoint3', tracker.getTrackerId())
            ])
        } catch (err) {
            errors += 1
        }
        expect(errors).toEqual(1)
    })  
})

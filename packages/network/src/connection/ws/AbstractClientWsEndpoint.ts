import WebSocket from 'ws'
import { PeerId, PeerInfo } from '../PeerInfo'
import { AbstractWsEndpoint, DisconnectionCode, DisconnectionReason } from "./AbstractWsEndpoint"
import { AbstractWsConnection, ReadyState } from "./AbstractWsConnection"
import { IMessageEvent, w3cwebsocket } from "websocket"

export type ServerUrl = string
export type SupportedWs = WebSocket | w3cwebsocket
export interface HandshakeValues { uuid: string, peerId: PeerId }

export interface WebSocketConnectionFactory<C extends AbstractWsConnection> {
    createConnection(socket: SupportedWs, peerInfo: PeerInfo): C
}

export abstract class AbstractClientWsEndpoint<C extends AbstractWsConnection> extends AbstractWsEndpoint<C> {
    protected readonly connectionsByServerUrl: Map<ServerUrl, C>
    protected readonly serverUrlByPeerId: Map<PeerId, ServerUrl>
    protected readonly pendingConnections: Map<ServerUrl, Promise<PeerId>>

    constructor(
        peerInfo: PeerInfo,
        pingInterval: number
    ) {
        super(peerInfo, pingInterval)

        this.connectionsByServerUrl = new Map()
        this.serverUrlByPeerId = new Map()
        this.pendingConnections = new Map()
    }

    getServerUrlByPeerId(peerId: PeerId): string | undefined {
        return this.serverUrlByPeerId.get(peerId)
    }

    protected doClose(connection: C, _code: DisconnectionCode, _reason: DisconnectionReason): void {
        const serverUrl = this.serverUrlByPeerId.get(connection.getPeerId())!
        this.connectionsByServerUrl.delete(serverUrl)
        this.serverUrlByPeerId.delete(connection.getPeerId())
    }

    protected async doStop(): Promise<void> {
        this.getConnections().forEach((connection) => {
            connection.close(DisconnectionCode.GRACEFUL_SHUTDOWN, DisconnectionReason.GRACEFUL_SHUTDOWN)
        })
    }

    connect(serverUrl: ServerUrl, serverPeerInfo: PeerInfo): Promise<PeerId> {
        // Check for existing connection and its state
        const existingConnection = this.connectionsByServerUrl.get(serverUrl)
        if (existingConnection !== undefined) {
            if (existingConnection.getReadyState() === 1 as ReadyState) {
                return Promise.resolve(existingConnection.getPeerId())
            }
            this.logger.trace('supposedly connected to %s but readyState is %s, closing connection',
                serverUrl,
                existingConnection.getReadyState()
            )
            this.close(
                existingConnection.getPeerId(),
                DisconnectionCode.DEAD_CONNECTION,
                DisconnectionReason.DEAD_CONNECTION
            )
        }

        // Check for pending connection
        const pendingConnection = this.pendingConnections.get(serverUrl)
        if (pendingConnection !== undefined) {
            return pendingConnection
        }

        // Perform connection
        this.logger.trace('connecting to %s', serverUrl)
        const p = this.doConnect(serverUrl, serverPeerInfo).finally(() => {
            this.pendingConnections.delete(serverUrl)
        })

        this.pendingConnections.set(serverUrl, p)
        return p
    }

    /**
     * Custom connect logic of subclass
     */
    protected abstract doConnect(serverUrl: ServerUrl, serverPeerInfo: PeerInfo): Promise<PeerId>

    /**
     * Init client-side handshake timeout
     */
    protected handshakeInit(ws: SupportedWs, serverPeerInfo: PeerInfo, reject: (reason?: any) => void
    ): void {
        const peerId = serverPeerInfo.peerId
        this.handshakeTimeoutRefs[peerId] = setTimeout(() => {
            ws.close(DisconnectionCode.FAILED_HANDSHAKE, `Handshake not received from ${peerId}`)
            this.logger.warn(`Handshake not received from ${peerId}`)
            delete this.handshakeTimeoutRefs[peerId]
            reject(`Handshake not received from ${peerId}`)
        }, this.handshakeTimer)
    }

    /**
     * Initial handshake message listener
     */
    protected handshakeListener(
        ws: SupportedWs,
        serverPeerInfo: PeerInfo,
        serverUrl: string,
        message: IMessageEvent | string | Buffer | Buffer[],
        resolve: (value: PeerId | PromiseLike<string>) => void
    ): void {
        try {
            const { uuid, peerId } = this.doHandshakeParse(message)
            if (uuid && peerId === serverPeerInfo.peerId) {
                this.clearHandshake(peerId)
                this.doHandshakeResponse(uuid, peerId, ws)
                resolve(this.setUpConnection(ws, serverPeerInfo, serverUrl))
            } else {
                this.logger.trace('Expected a handshake message got: ' + message)
            }
        } catch (err) {
            this.logger.trace(err)
        }
    }

    protected onHandshakeError(serverUrl: string, error: Error, reject: (reason?: any) => void): void {
        this.logger.trace('failed to connect to %s, error: %o', serverUrl, error)
        reject(error)
    }

    protected onHandshakeClosed(serverUrl: string, code: number, reason: string, reject: (reason?: any) => void): void {
        this.logger.trace(`Connection to ${serverUrl} closed during handshake with code: ${code}, reason ${reason}`)
        reject(reason)
    }

    protected ongoingConnectionError(serverPeerId: PeerId, error: Error, connection: AbstractWsConnection): void {
        this.logger.trace('Connection to %s failed, error: %o', serverPeerId, error)
        connection.terminate()
    }

    /**
     * Send a handshake response back to the server
     */
    protected abstract doHandshakeResponse(uuid: string, peerId: PeerId, ws: SupportedWs): void

    /**
     * Parse handshake message
     */
    protected abstract doHandshakeParse(message: string | Buffer | Buffer[] | IMessageEvent): HandshakeValues

    /**
     * Finalise WS connection e.g. add final event listeners
     */
    protected abstract doSetUpConnection(ws: SupportedWs, serverPeerInfo: PeerInfo): C

    private setUpConnection(ws: SupportedWs, serverPeerInfo: PeerInfo, serverUrl: ServerUrl): PeerId {
        const connection = this.doSetUpConnection(ws, serverPeerInfo)

        this.connectionsByServerUrl.set(serverUrl, connection)
        this.serverUrlByPeerId.set(connection.getPeerId(), serverUrl)
        this.onNewConnection(connection)
        return connection.getPeerId()
    }
}

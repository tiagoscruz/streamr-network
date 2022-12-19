import { StreamID } from "@streamr/protocol"

export const PersistenceInjectionToken = Symbol('PersistenceInjectionToken')

export interface Persistence<K, V> {
    get(key: K, streamId: StreamID): Promise<V | undefined>
    set(key: K, value: V, streamId: StreamID): Promise<void>
    close(): Promise<void>
}

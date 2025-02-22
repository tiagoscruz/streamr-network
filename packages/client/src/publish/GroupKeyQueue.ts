import { StreamID } from '@streamr/protocol'
import { GroupKey } from '../encryption/GroupKey'
import { GroupKeyStore } from '../encryption/GroupKeyStore'

export interface GroupKeySequence {
    current: GroupKey
    next?: GroupKey
}

export class GroupKeyQueue {

    private currentGroupKey: GroupKey | undefined
    private queuedGroupKey: GroupKey | undefined // a group key queued to be rotated into use after the call to useGroupKey
    private readonly streamId: StreamID
    private readonly store: GroupKeyStore

    constructor(streamId: StreamID, store: GroupKeyStore) {
        this.streamId = streamId
        this.store = store
    }

    async useGroupKey(): Promise<GroupKeySequence> {
        // Ensure we have a current key by picking a queued key or generating a new one
        if (!this.currentGroupKey) {
            this.currentGroupKey = this.queuedGroupKey || await this.rekey()
            this.queuedGroupKey = undefined
        }
        // Always return an array consisting of currentGroupKey and queuedGroupKey (latter may be undefined)
        const result: GroupKeySequence = {
            current: this.currentGroupKey!,
            next: this.queuedGroupKey,
        }
        // Perform the rotate if there's a next key queued
        if (this.queuedGroupKey) {
            this.currentGroupKey = this.queuedGroupKey
            this.queuedGroupKey = undefined
        }
        return result
    }

    async rotate(newKey = GroupKey.generate()): Promise<GroupKey> {
        this.queuedGroupKey = newKey
        await this.store.add(newKey, this.streamId)
        return newKey
    }

    async rekey(newKey = GroupKey.generate()): Promise<GroupKey> {
        await this.store.add(newKey, this.streamId)
        this.currentGroupKey = newKey
        this.queuedGroupKey = undefined
        return newKey
    }
}

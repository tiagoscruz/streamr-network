import { instanceId, pOnce } from './index'
import { Debug } from './log'
import { iteratorFinally } from './iterators'
import { IPushBuffer, PushBuffer, DEFAULT_BUFFER_SIZE, pull } from './PushBuffer'
import { ContextError, Context } from './Context'
import * as G from './GeneratorUtils'

export type PipelineTransform<InType = any, OutType = any> = (src: AsyncGenerator<InType>) => AsyncGenerator<OutType>
export type FinallyFn = ((err?: Error) => void | Promise<void>)

class PipelineError extends ContextError {}

/**
 * Pipeline public interface
 */
export type IPipeline<InType, OutType = InType> = {
    pipe<NewOutType>(fn: PipelineTransform<OutType, NewOutType>): IPipeline<InType, NewOutType>
    map<NewOutType>(fn: G.GeneratorMap<OutType, NewOutType>): IPipeline<InType, NewOutType>
    pipeBefore(fn: PipelineTransform<InType, InType>): IPipeline<InType, OutType>
    onFinally(onFinally: FinallyFn): IPipeline<InType, OutType>
} & AsyncGenerator<OutType> & Context

export class Pipeline<InType, OutType = InType> implements IPipeline<InType, OutType> {
    debug
    id
    readonly source: AsyncGenerator<InType>
    protected readonly transforms: PipelineTransform[] = []
    protected readonly transformsBefore: PipelineTransform[] = []
    protected iterator: AsyncGenerator<OutType>
    protected finallyTasks: FinallyFn[] = []
    protected isIterating: string | false = false

    constructor(source: AsyncGenerator<InType>) {
        this.source = source
        this.id = instanceId(this)
        this.cleanup = pOnce(this.cleanup.bind(this))
        this.debug = Debug(this.id)
        this.iterator = iteratorFinally(this.iterate(), this.cleanup)
        // this.debug('create')
    }

    /**
     * Append a transformation step to this pipeline.
     * Changes the pipeline's output type to output type of this generator.
     */
    pipe<NewOutType>(fn: PipelineTransform<OutType, NewOutType>): Pipeline<InType, NewOutType> {
        if (this.isIterating) {
            throw new PipelineError(this, `cannot pipe after already iterating: ${this.isIterating}`)
        }

        this.transforms.push(fn)
        // this allows .pipe chaining to be type aware
        // i.e. new Pipeline(Type1).pipe(Type1 => Type2).pipe(Type2 => Type3)
        return this as Pipeline<InType, unknown> as Pipeline<InType, NewOutType>
    }

    /**
     * Inject pipeline step before other transforms.
     * Note must return same type as source, otherwise we can't be type-safe.
     */
    pipeBefore(fn: PipelineTransform<InType, InType>): Pipeline<InType, OutType> {
        if (this.isIterating) {
            throw new PipelineError(this, `cannot pipe after already iterating: ${this.isIterating}`)
        }

        this.transformsBefore.push(fn)
        return this
    }

    /**
     * Append a function to run when pipeline ends.
     */
    onFinally(onFinallyFn: FinallyFn) {
        this.finallyTasks.push(onFinallyFn)
        return this
    }

    private async runFinally(err?: Error) {
        let error = err
        if (!this.finallyTasks.length) { return }
        await this.finallyTasks.reduce(async (prev, task) => {
            return prev.then(() => {
                return task(error)
            }, (internalErr) => {
                error = internalErr
                return task(error)
            })
        }, Promise.resolve()) // eslint-disable-line promise/no-promise-in-callback
    }

    map<NewOutType>(fn: G.GeneratorMap<OutType, NewOutType>) {
        return this.pipe((src) => G.map(src, fn))
    }

    forEach(fn: G.GeneratorForEach<OutType>) {
        return this.pipe((src) => G.forEach(src, fn))
    }

    filter(fn: G.GeneratorFilter<OutType>) {
        return this.pipe((src) => G.filter(src, fn))
    }

    reduce<NewOutType>(fn: G.GeneratorReduce<OutType, NewOutType>, initialValue: NewOutType) {
        return this.pipe((src) => G.reduce(src, fn, initialValue))
    }

    forEachBefore(fn: G.GeneratorForEach<InType>) {
        return this.pipeBefore((src) => G.forEach(src, fn))
    }

    filterBefore(fn: G.GeneratorFilter<InType>) {
        return this.pipeBefore((src) => G.filter(src, fn))
    }

    consume(fn: G.GeneratorForEach<OutType>) {
        return G.consume(this, fn)
    }

    collect(n?: number) {
        return G.collect(this, n)
    }

    private async cleanup(error?: Error) {
        try {
            if (error) {
                await this.source.throw(error)
            } else {
                await this.source.return(undefined)
            }
        } finally {
            await this.runFinally(error)
        }
    }

    private async* iterate() {
        console.trace()
        this.isIterating = String(new Error().stack).split('\n').slice(3).join('\n\n') || ''
        if (!this.source) {
            throw new PipelineError(this, 'no source')
        }

        const transforms = [...this.transformsBefore, ...this.transforms]

        if (!transforms.length) {
            yield* this.source
            return
        }

        yield* transforms.reduce((prev: AsyncGenerator, transform) => {
            // each pipeline step creates a generator
            // which is then passed into the next transform
            // end result is output of last transform's generator
            // pulled into an async buffer
            return transform(prev)
        }, this.source)
    }

    // AsyncGenerator implementation

    async throw(err: Error) {
        // eslint-disable-next-line promise/no-promise-in-callback
        await this.source.throw(err).catch(() => {})
        return this.iterator.throw(err)
    }

    async return(v?: OutType) {
        await this.source.return(undefined)
        return this.iterator.return(v)
    }

    async next() {
        return this.iterator.next()
    }

    [Symbol.asyncIterator]() {
        if (this.isIterating) {
            throw new PipelineError(this, 'cannot iterate, already iterating')
        }

        return this
    }
}

/**
 * Pipeline that is also a PushBuffer.
 * i.e. can call .push to push data into pipeline and .pipe to transform it.
 */

export class PushPipeline<InType, OutType = InType> extends Pipeline<InType, OutType> implements IPushBuffer<InType, OutType> {
    readonly source: PushBuffer<InType>
    constructor(bufferSize = DEFAULT_BUFFER_SIZE) {
        const inputBuffer = new PushBuffer<InType>(bufferSize)
        super(inputBuffer)
        this.source = inputBuffer
    }

    pipe<NewOutType>(fn: PipelineTransform<OutType, NewOutType>): PushPipeline<InType, NewOutType> {
        // this method override just fixes the output type to be PushPipeline rather than Pipeline
        super.pipe(fn)
        return this as PushPipeline<InType, unknown> as PushPipeline<InType, NewOutType>
    }

    map<NewOutType>(fn: G.GeneratorMap<OutType, NewOutType>): PushPipeline<InType, NewOutType> {
        // this method override just fixes the output type to be PushPipeline rather than Pipeline
        return super.map(fn) as PushPipeline<InType, NewOutType>
    }

    filterBefore(fn: G.GeneratorFilter<InType>): PushPipeline<InType, OutType> {
        // this method override just fixes the output type to be PushPipeline rather than Pipeline
        return super.filterBefore(fn) as PushPipeline<InType, OutType>
    }

    filter(fn: G.GeneratorFilter<OutType>): PushPipeline<InType, OutType> {
        // this method override just fixes the output type to be PushPipeline rather than Pipeline
        return super.filter(fn) as PushPipeline<InType, OutType>
    }

    forEach(fn: G.GeneratorForEach<OutType>): PushPipeline<InType, OutType> {
        // this method override just fixes the output type to be PushPipeline rather than Pipeline
        return super.forEach(fn) as PushPipeline<InType, OutType>
    }

    forEachBefore(fn: G.GeneratorForEach<InType>): PushPipeline<InType, OutType> {
        // this method override just fixes the output type to be PushPipeline rather than Pipeline
        return super.forEachBefore(fn) as PushPipeline<InType, OutType>
    }

    pull(source: AsyncGenerator<InType>) {
        return pull(source, this)
    }

    // wrapped PushBuffer methods below here

    async push(item: InType) {
        return this.source.push(item)
    }

    end(err?: Error) {
        return this.source.end(err)
    }

    endWrite(err?: Error) {
        return this.source.endWrite(err)
    }

    isDone() {
        return this.source.isDone()
    }

    get length() {
        return this.source.length || 0
    }

    isFull() {
        return this.source.isFull()
    }
}

import { inject, Lifecycle, scoped } from 'tsyringe'
import { ConfigInjectionToken, StrictStreamrClientConfig } from '../Config'
import fetch, { Response } from 'node-fetch'
import { Logger } from '@streamr/utils'
import { LoggerFactory } from './LoggerFactory'

@scoped(Lifecycle.ContainerScoped)
export class HttpFetcher {

    private config: Pick<StrictStreamrClientConfig, '_timeouts'>
    private readonly logger: Logger

    constructor(
        @inject(LoggerFactory) loggerFactory: LoggerFactory,
        @inject(ConfigInjectionToken) config: Pick<StrictStreamrClientConfig, '_timeouts'>
    ) {
        this.config = config
        this.logger = loggerFactory.createLogger(module)
    }

    fetch(url: string, init?: Record<string, unknown>): Promise<Response> {
        // eslint-disable-next-line no-underscore-dangle
        const timeout = this.config._timeouts.httpFetchTimeout
        this.logger.debug('fetching %s (timeout %d ms)', url, timeout)
        return fetch(url, {
            timeout,
            ...init
        } as any)
    }
}

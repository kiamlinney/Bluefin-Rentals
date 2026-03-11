import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { getRouter } from './router'

const router = getRouter()

export default createStartHandler({
    router,
    streamHandler: defaultStreamHandler,
})
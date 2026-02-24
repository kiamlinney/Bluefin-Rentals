import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { getRouter } from './router'

const handler = createStartHandler({
    createRouter: getRouter,
})

export default handler(defaultStreamHandler)
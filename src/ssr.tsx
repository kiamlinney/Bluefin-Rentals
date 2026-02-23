import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { getRouter } from './router'

// We pass the getRouter function directly
const handler = createStartHandler({
    createRouter: getRouter,
})

// Some versions of H3/Nitro (the server engine) need the handler
// to be exported this way to properly capture the request protocol
export default handler(defaultStreamHandler)
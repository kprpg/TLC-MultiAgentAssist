declare module '*.css'

declare module '*.png' {
    const source: string
    export default source
}

declare module '*?raw' {
    const content: string
    export default content
}

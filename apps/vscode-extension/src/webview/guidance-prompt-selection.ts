export function selectGuidancePrompt(
    prompt: string,
    setPrompt: (prompt: string) => void,
    dispatchPrompt: (prompt: string) => void
): void {
    setPrompt(prompt)
    dispatchPrompt(prompt)
}

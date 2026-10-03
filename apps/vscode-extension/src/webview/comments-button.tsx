import type { ReactElement } from 'react'

export function CommentsButton({ title = 'Comments', onClick }: { title?: string; onClick(): void }): ReactElement {
    return (
        <button className="comments-button" type="button" title={title} onClick={onClick}>
            Comments
        </button>
    )
}
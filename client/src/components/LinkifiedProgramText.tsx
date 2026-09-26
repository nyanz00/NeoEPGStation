import { Link } from '@mui/material';
import type { ReactNode } from 'react';

const urlPattern = /(https?:\/\/[\x21-\x7e]+)/gi;

export function LinkifiedProgramText({ text }: { text: string }): ReactNode {
    return (
        <>
            {text.split(urlPattern).map((part, index) =>
                /^https?:\/\//i.test(part) ? (
                    <Link key={index} href={part} target="_blank" rel="noopener noreferrer">
                        {part}
                    </Link>
                ) : (
                    part
                ),
            )}
        </>
    );
}

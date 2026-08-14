import { SvgIcon } from '@mui/material';
import type { ReactElement } from 'react';

export function AlphaAIcon(): ReactElement {
    return (
        <SvgIcon viewBox="0 0 24 24" sx={{ ml: '-1px', fontSize: 27 }}>
            <path transform="translate(12 12) scale(1.8) translate(-12 -12)" d="M11,7A2,2 0 0,0 9,9V17H11V13H13V17H15V9A2,2 0 0,0 13,7H11M11,9H13V11H11V9Z" />
        </SvgIcon>
    );
}

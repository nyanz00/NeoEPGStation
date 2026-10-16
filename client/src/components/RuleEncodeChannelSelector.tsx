import { Autocomplete, Checkbox, TextField } from '@mui/material';
import { type ReactNode, useMemo, useState } from 'react';
import type { ChannelId, ChannelItem } from '../../../api';
import { isAudioVideoChannel } from '../core/channels';
import { normalizeChannelFilter } from '../core/program';

export function RuleEncodeChannelSelector({
    channels,
    channelIds,
    onChange,
}: {
    channels: ChannelItem[];
    channelIds: ChannelId[];
    onChange: (channelIds: ChannelId[]) => void;
}): ReactNode {
    const selectableChannels = useMemo(() => channels.filter(isAudioVideoChannel), [channels]);
    const selectedChannels = useMemo(() => channels.filter(channel => channelIds.includes(channel.id)), [channels, channelIds]);
    const [inputValue, setInputValue] = useState('');

    return (
        <Autocomplete
            multiple
            disableCloseOnSelect
            options={selectableChannels}
            value={selectedChannels}
            inputValue={inputValue}
            onInputChange={(_event, nextInputValue, reason) => {
                // A refreshed options/value array must not erase a filter the user is typing.
                if (reason !== 'reset') setInputValue(nextInputValue);
            }}
            filterOptions={(options, { inputValue: filter }) => {
                const normalizedFilter = normalizeChannelFilter(filter);
                return normalizedFilter.length === 0 ? options : options.filter(channel => normalizeChannelFilter(channel.name).includes(normalizedFilter));
            }}
            getOptionLabel={channel => channel.name}
            getOptionKey={channel => channel.id}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_event, selected) => onChange(selected.map(channel => channel.id))}
            renderOption={(props, channel, state) => {
                const { key, ...optionProps } = props;
                return (
                    <li key={key} {...optionProps}>
                        <Checkbox checked={state.selected} sx={{ mr: 1 }} />
                        {channel.name}
                    </li>
                );
            }}
            renderInput={params => <TextField {...params} size="small" label="対象局（未指定なら全局）" />}
        />
    );
}

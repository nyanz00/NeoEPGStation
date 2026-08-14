import { Autocomplete, TextField } from '@mui/material';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete';
import type { ReactNode } from 'react';
import { normalizeChannelFilter } from '../core/program';

export interface ChannelSelectorOption {
    id: number;
    label: string;
    searchText?: string;
}

interface CommonChannelSelectorProps {
    options: ChannelSelectorOption[];
    label?: string;
    placeholder?: string;
    loading?: boolean;
    required?: boolean;
}

type ChannelSelectorProps =
    | (CommonChannelSelectorProps & {
          multiple: true;
          value: number[];
          onChange: (value: number[]) => void;
      })
    | (CommonChannelSelectorProps & {
          multiple?: false;
          value: number | '';
          onChange: (value: number | '') => void;
      });

function filterChannelOptions(options: ChannelSelectorOption[], inputValue: string): ChannelSelectorOption[] {
    const needle = normalizeChannelFilter(inputValue);
    if (needle.length === 0) return options;
    return options.filter(option => normalizeChannelFilter(option.searchText ?? option.label).includes(needle));
}

export function ChannelSelector({
    options,
    label = '放送局',
    placeholder = '局名を入力して絞り込み',
    loading = false,
    required = false,
    ...selection
}: ChannelSelectorProps): ReactNode {
    const commonProps = {
        options,
        loading,
        filterOptions: (items: ChannelSelectorOption[], state: { inputValue: string }) => filterChannelOptions(items, state.inputValue),
        getOptionLabel: (option: ChannelSelectorOption) => option.label,
        getOptionKey: (option: ChannelSelectorOption) => option.id,
        isOptionEqualToValue: (option: ChannelSelectorOption, selected: ChannelSelectorOption) => option.id === selected.id,
        noOptionsText: '該当する放送局がありません',
        renderInput: (params: AutocompleteRenderInputParams) => <TextField {...params} required={required} label={label} placeholder={placeholder} />,
    };

    if (selection.multiple) {
        return (
            <Autocomplete
                {...commonProps}
                multiple
                value={options.filter(option => selection.value.includes(option.id))}
                onChange={(_event, value) => selection.onChange(value.map(option => option.id))}
            />
        );
    }

    return (
        <Autocomplete {...commonProps} value={options.find(option => option.id === selection.value) ?? null} onChange={(_event, value) => selection.onChange(value?.id ?? '')} />
    );
}

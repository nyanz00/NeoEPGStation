import AddAPhotoOutlined from '@mui/icons-material/AddAPhotoOutlined';
import ChatBubbleOutlineOutlined from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import FavoriteBorderOutlined from '@mui/icons-material/FavoriteBorderOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import RepeatOutlined from '@mui/icons-material/RepeatOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import Twitter from '@mui/icons-material/Twitter';
import { Alert, Avatar, Box, Button, Chip, CircularProgress, Divider, IconButton, Menu, MenuItem, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { TwitterTweet } from '../../../api';
import { api } from '../core/api/queries';
import { withBasePath } from '../core/path';
import { useViewerProfile } from '../core/storage/viewerProfile';
import BlueskyIcon from './icons/BlueskyIcon';
import MisskeyIcon from './icons/MisskeyIcon';

type TwitterInnerTab = 'search' | 'timeline' | 'capture';
type SocialTarget = 'twitter' | 'bluesky' | 'misskey' | 'twitter-bluesky' | 'all';

interface TwitterCapture {
    id: number;
    blob: Blob;
    url: string;
    selected: boolean;
}

export interface TwitterPanelProps {
    programTitle?: string;
    channelName?: string;
    videoSelector: string;
}

const HASHTAG_STORAGE_KEY = 'NeoEPGStationTwitterHashtags';
const SOCIAL_TARGET_STORAGE_KEY = 'NeoEPGStationSocialTarget';
const MAX_CAPTURE_COUNT = 12;
const MAX_SELECTED_CAPTURE_COUNT = 4;

function normalizedHashtags(value: string): string[] {
    return value
        .split(/[\s,、]+/)
        .map(item => item.replace(/^#+/, '').replace(/\s+/g, ''))
        .filter((item, index, values) => item.length > 0 && values.indexOf(item) === index);
}

function readSavedHashtags(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(HASHTAG_STORAGE_KEY) ?? '[]') as unknown;
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
    } catch {
        return [];
    }
}

function openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
}

function readSocialTarget(): SocialTarget {
    const value = localStorage.getItem(SOCIAL_TARGET_STORAGE_KEY);
    if (value === 'both') return 'twitter-bluesky';
    return value === 'bluesky' || value === 'misskey' || value === 'twitter-bluesky' || value === 'all' ? value : 'twitter';
}

function socialTargetLabel(target: SocialTarget): string {
    if (target === 'twitter') return 'Twitter';
    if (target === 'bluesky') return 'Bluesky';
    if (target === 'misskey') return 'Misskey.io';
    if (target === 'twitter-bluesky') return 'Twitter + Bluesky';
    return '連携済みSNSすべて';
}

function socialTargetIcon(target: SocialTarget): ReactNode {
    if (target === 'twitter') return <Twitter />;
    if (target === 'bluesky') return <BlueskyIcon />;
    if (target === 'misskey') return <MisskeyIcon />;
    return (
        <Stack direction="row" spacing={0.15}>
            <Twitter fontSize="small" />
            <BlueskyIcon fontSize="small" />
            {target === 'all' && <MisskeyIcon fontSize="small" />}
        </Stack>
    );
}

function mergeTweets(...groups: Array<TwitterTweet[] | undefined>): TwitterTweet[] {
    const unique = new Map<string, TwitterTweet>();
    groups.flatMap(group => group ?? []).forEach(tweet => unique.set(`${tweet.source ?? 'twitter'}:${tweet.id}`, tweet));
    return Array.from(unique.values()).sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
    if (video.videoWidth <= 0 || video.videoHeight <= 0) throw new Error('映像がまだ表示されていません。');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('キャプチャ用Canvasを作成できません。');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob === null) reject(new Error('映像を画像へ変換できません。'));
            else resolve(blob);
        }, 'image/png');
    });
}

function TweetCard({ tweet }: { tweet: TwitterTweet }): ReactNode {
    return (
        <Box sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                <Avatar src={tweet.authorIconUrl} alt="" sx={{ width: 38, height: 38 }}>
                    {tweet.authorName.slice(0, 1)}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline', minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
                            {tweet.authorName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                            @{tweet.authorScreenName}
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        {tweet.createdAt !== undefined && (
                            <Typography variant="caption" color="text.secondary" noWrap>
                                {new Date(tweet.createdAt).toLocaleString(undefined, {
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </Typography>
                        )}
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {tweet.text}
                    </Typography>
                    {tweet.imageUrls.length > 0 && (
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: tweet.imageUrls.length === 1 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
                                gap: 0.5,
                                mt: 1,
                                overflow: 'hidden',
                                borderRadius: 1.5,
                            }}
                        >
                            {tweet.imageUrls.slice(0, 4).map(url => (
                                <Box
                                    key={url}
                                    component="img"
                                    src={url}
                                    alt=""
                                    loading="lazy"
                                    sx={{ width: '100%', height: tweet.imageUrls.length === 1 ? 220 : 120, objectFit: 'cover' }}
                                />
                            ))}
                        </Box>
                    )}
                    <Stack direction="row" spacing={2.25} sx={{ alignItems: 'center', mt: 0.75, color: 'text.secondary' }}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            <ChatBubbleOutlineOutlined sx={{ fontSize: 16 }} />
                            <Typography variant="caption">{tweet.replyCount}</Typography>
                        </Stack>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: tweet.retweeted ? 'success.main' : 'inherit' }}>
                            <RepeatOutlined sx={{ fontSize: 17 }} />
                            <Typography variant="caption">{tweet.retweetCount}</Typography>
                        </Stack>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: tweet.liked ? 'error.main' : 'inherit' }}>
                            <FavoriteBorderOutlined sx={{ fontSize: 16 }} />
                            <Typography variant="caption">{tweet.likeCount}</Typography>
                        </Stack>
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title={`${tweet.source === 'bluesky' ? 'Bluesky' : tweet.source === 'misskey' ? 'Misskey.io' : 'Twitter'}で開く`}>
                            <IconButton size="small" onClick={() => openExternal(tweet.url)}>
                                <OpenInNewOutlined sx={{ fontSize: 17 }} />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                </Box>
            </Stack>
        </Box>
    );
}

function TweetList({ tweets, loading, error, emptyMessage }: { tweets?: TwitterTweet[]; loading: boolean; error?: Error | null; emptyMessage: string }): ReactNode {
    if (loading) {
        return (
            <Stack sx={{ minHeight: 180, alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress size={30} />
            </Stack>
        );
    }
    if (error !== undefined && error !== null) {
        return (
            <Alert severity="error" sx={{ m: 1.5 }}>
                SNSから取得できませんでした: {error.message}
            </Alert>
        );
    }
    if (tweets === undefined || tweets.length === 0) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ py: 5, px: 2, textAlign: 'center' }}>
                {emptyMessage}
            </Typography>
        );
    }
    return tweets.map(tweet => <TweetCard key={`${tweet.source ?? 'twitter'}:${tweet.id}`} tweet={tweet} />);
}

export function TwitterPanel({ programTitle = '', channelName = '', videoSelector }: TwitterPanelProps): ReactNode {
    const viewerProfile = useViewerProfile();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<TwitterInnerTab>('search');
    const [socialTarget, setSocialTarget] = useState<SocialTarget>(readSocialTarget);
    const [accountMenuAnchor, setAccountMenuAnchor] = useState<HTMLElement | null>(null);
    const [query, setQuery] = useState(programTitle);
    const [submittedQuery, setSubmittedQuery] = useState(programTitle);
    const [tweetText, setTweetText] = useState('');
    const [hashtagText, setHashtagText] = useState('');
    const [savedHashtags, setSavedHashtags] = useState<string[]>(readSavedHashtags);
    const [captures, setCaptures] = useState<TwitterCapture[]>([]);
    const [message, setMessage] = useState<{
        severity: 'success' | 'warning' | 'error';
        text: string;
    } | null>(null);
    const capturesRef = useRef<TwitterCapture[]>([]);

    const twitterStatus = useQuery({
        queryKey: ['twitter', 'status', viewerProfile.profileId, viewerProfile.sessionToken],
        queryFn: api.getTwitterStatus,
        retry: false,
    });
    const blueskyStatus = useQuery({
        queryKey: ['bluesky', 'status', viewerProfile.profileId, viewerProfile.sessionToken],
        queryFn: api.getBlueskyStatus,
        retry: false,
    });
    const misskeyStatus = useQuery({
        queryKey: ['misskey', 'status', viewerProfile.profileId, viewerProfile.sessionToken],
        queryFn: api.getMisskeyStatus,
        retry: false,
    });
    const twitterConfigured = twitterStatus.data?.configured === true;
    const blueskyConfigured = blueskyStatus.data?.configured === true;
    const misskeyConfigured = misskeyStatus.data?.configured === true;
    const configuredCount = [twitterConfigured, blueskyConfigured, misskeyConfigured].filter(Boolean).length;
    const anySocialConfigured = configuredCount > 0;
    const selectedTargetConfigured =
        socialTarget === 'twitter'
            ? twitterConfigured
            : socialTarget === 'bluesky'
              ? blueskyConfigured
              : socialTarget === 'misskey'
                ? misskeyConfigured
                : socialTarget === 'twitter-bluesky'
                  ? twitterConfigured && blueskyConfigured
                  : anySocialConfigured;
    const usesTwitter = socialTarget === 'twitter' || socialTarget === 'twitter-bluesky' || socialTarget === 'all';
    const usesBluesky = socialTarget === 'bluesky' || socialTarget === 'twitter-bluesky' || socialTarget === 'all';
    const usesMisskey = socialTarget === 'misskey' || socialTarget === 'all';
    const selectedTargetIcon =
        socialTarget === 'all' ? (
            <Stack direction="row" spacing={0.15}>
                {twitterConfigured && <Twitter fontSize="small" />}
                {blueskyConfigured && <BlueskyIcon fontSize="small" />}
                {misskeyConfigured && <MisskeyIcon fontSize="small" />}
            </Stack>
        ) : (
            socialTargetIcon(socialTarget)
        );
    const twitterSearch = useQuery({
        queryKey: ['twitter', 'search', viewerProfile.profileId, viewerProfile.sessionToken, submittedQuery],
        queryFn: () => api.searchTwitter(submittedQuery),
        enabled: activeTab === 'search' && usesTwitter && twitterConfigured && submittedQuery.trim().length > 0,
        retry: false,
        staleTime: 15_000,
    });
    const blueskySearch = useQuery({
        queryKey: ['bluesky', 'search', viewerProfile.profileId, viewerProfile.sessionToken, submittedQuery],
        queryFn: () => api.searchBluesky(submittedQuery),
        enabled: activeTab === 'search' && usesBluesky && blueskyConfigured && submittedQuery.trim().length > 0,
        retry: false,
        staleTime: 15_000,
    });
    const misskeySearch = useQuery({
        queryKey: ['misskey', 'search', viewerProfile.profileId, viewerProfile.sessionToken, submittedQuery],
        queryFn: () => api.searchMisskey(submittedQuery),
        enabled: activeTab === 'search' && usesMisskey && misskeyConfigured && submittedQuery.trim().length > 0,
        retry: false,
        staleTime: 15_000,
    });
    const twitterTimeline = useQuery({
        queryKey: ['twitter', 'timeline', viewerProfile.profileId, viewerProfile.sessionToken],
        queryFn: api.getTwitterTimeline,
        enabled: activeTab === 'timeline' && usesTwitter && twitterConfigured,
        retry: false,
        staleTime: 15_000,
    });
    const blueskyTimeline = useQuery({
        queryKey: ['bluesky', 'timeline', viewerProfile.profileId, viewerProfile.sessionToken],
        queryFn: api.getBlueskyTimeline,
        enabled: activeTab === 'timeline' && usesBluesky && blueskyConfigured,
        retry: false,
        staleTime: 15_000,
    });
    const misskeyTimeline = useQuery({
        queryKey: ['misskey', 'timeline', viewerProfile.profileId, viewerProfile.sessionToken],
        queryFn: api.getMisskeyTimeline,
        enabled: activeTab === 'timeline' && usesMisskey && misskeyConfigured,
        retry: false,
        staleTime: 15_000,
    });

    useEffect(() => {
        setQuery(programTitle);
        setSubmittedQuery(programTitle);
    }, [programTitle]);
    useEffect(() => {
        capturesRef.current = captures;
    }, [captures]);
    useEffect(() => {
        let next = socialTarget;
        const firstConfigured: SocialTarget = twitterConfigured ? 'twitter' : blueskyConfigured ? 'bluesky' : misskeyConfigured ? 'misskey' : 'twitter';
        if (socialTarget === 'twitter-bluesky' && (!twitterConfigured || !blueskyConfigured)) {
            next = firstConfigured;
        } else if (socialTarget === 'all') {
            if (configuredCount < 2) next = firstConfigured;
            else if (configuredCount === 2 && twitterConfigured && blueskyConfigured) next = 'twitter-bluesky';
        } else if ((socialTarget === 'twitter' && !twitterConfigured) || (socialTarget === 'bluesky' && !blueskyConfigured) || (socialTarget === 'misskey' && !misskeyConfigured)) {
            next = configuredCount >= 2 ? 'all' : firstConfigured;
        }
        if (next !== socialTarget) setSocialTarget(next);
        localStorage.setItem(SOCIAL_TARGET_STORAGE_KEY, next);
    }, [blueskyConfigured, configuredCount, misskeyConfigured, socialTarget, twitterConfigured]);
    useEffect(
        () => () => {
            capturesRef.current.forEach(capture => URL.revokeObjectURL(capture.url));
        },
        [],
    );

    const hashtags = useMemo(() => normalizedHashtags(hashtagText), [hashtagText]);
    const composedText = useMemo(() => [tweetText.trim(), hashtags.map(hashtag => `#${hashtag}`).join(' ')].filter(value => value.length > 0).join('\n'), [hashtags, tweetText]);
    const remaining = (usesTwitter ? 280 : usesBluesky ? 300 : 3000) - Array.from(composedText).length;
    const selectedCaptures = captures.filter(capture => capture.selected);
    const searchTweets = mergeTweets(twitterSearch.data?.tweets, blueskySearch.data?.tweets, misskeySearch.data?.tweets);
    const timelineTweets = mergeTweets(twitterTimeline.data?.tweets, blueskyTimeline.data?.tweets, misskeyTimeline.data?.tweets);
    const searchFetching = twitterSearch.isFetching || blueskySearch.isFetching || misskeySearch.isFetching;
    const timelineFetching = twitterTimeline.isFetching || blueskyTimeline.isFetching || misskeyTimeline.isFetching;
    const searchError = searchTweets.length > 0 ? null : (twitterSearch.error ?? blueskySearch.error ?? misskeySearch.error);
    const timelineError = timelineTweets.length > 0 ? null : (twitterTimeline.error ?? blueskyTimeline.error ?? misskeyTimeline.error);
    const postTweet = useMutation({
        mutationFn: async () => {
            const operations: Array<{ name: string; promise: Promise<void> }> = [];
            if (usesTwitter && twitterConfigured) operations.push({ name: 'Twitter', promise: api.postTweet(composedText) });
            if (usesBluesky && blueskyConfigured) operations.push({ name: 'Bluesky', promise: api.postBluesky(composedText) });
            if (usesMisskey && misskeyConfigured) operations.push({ name: 'Misskey.io', promise: api.postMisskey(composedText) });
            const results = await Promise.allSettled(operations.map(operation => operation.promise));
            const succeeded = operations.filter((_, index) => results[index]?.status === 'fulfilled').map(operation => operation.name);
            const failed = operations.flatMap((operation, index) => {
                const result = results[index];
                if (result?.status === 'rejected') {
                    const reason = result?.status === 'rejected' ? result.reason : undefined;
                    return [`${operation.name}: ${reason instanceof Error ? reason.message : String(reason)}`];
                }
                return [];
            });
            if (succeeded.length === 0) throw new Error(failed.join(' / ') || '投稿先が選択されていません');
            return { succeeded, failed };
        },
        onSuccess: async result => {
            setTweetText('');
            setMessage({
                severity: result.failed.length === 0 ? 'success' : 'warning',
                text: result.failed.length === 0 ? `${result.succeeded.join('と')}へ投稿しました。` : `${result.succeeded.join('と')}へ投稿しました。${result.failed.join(' / ')}`,
            });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['twitter', 'timeline'] }),
                submittedQuery.length > 0 ? queryClient.invalidateQueries({ queryKey: ['twitter', 'search'] }) : Promise.resolve(),
                queryClient.invalidateQueries({ queryKey: ['bluesky', 'timeline'] }),
                submittedQuery.length > 0 ? queryClient.invalidateQueries({ queryKey: ['bluesky', 'search'] }) : Promise.resolve(),
                queryClient.invalidateQueries({ queryKey: ['misskey', 'timeline'] }),
                submittedQuery.length > 0 ? queryClient.invalidateQueries({ queryKey: ['misskey', 'search'] }) : Promise.resolve(),
            ]);
        },
        onError: error => setMessage({ severity: 'error', text: `投稿できませんでした: ${error.message}` }),
    });

    const runSearch = (): void => {
        const value = query.trim();
        if (value.length === 0) return;
        if (value === submittedQuery) {
            if (usesTwitter && twitterConfigured) void twitterSearch.refetch();
            if (usesBluesky && blueskyConfigured) void blueskySearch.refetch();
            if (usesMisskey && misskeyConfigured) void misskeySearch.refetch();
        } else setSubmittedQuery(value);
    };

    const selectSocialTarget = (target: SocialTarget): void => {
        setSocialTarget(target);
        localStorage.setItem(SOCIAL_TARGET_STORAGE_KEY, target);
        setAccountMenuAnchor(null);
    };

    const saveHashtags = (): void => {
        if (hashtags.length === 0) return;
        const next = [...hashtags, ...savedHashtags].filter((item, index, values) => values.indexOf(item) === index).slice(0, 20);
        setSavedHashtags(next);
        localStorage.setItem(HASHTAG_STORAGE_KEY, JSON.stringify(next));
        setMessage({ severity: 'success', text: 'ハッシュタグを保存しました。' });
    };

    const removeSavedHashtag = (hashtag: string): void => {
        const next = savedHashtags.filter(item => item !== hashtag);
        setSavedHashtags(next);
        localStorage.setItem(HASHTAG_STORAGE_KEY, JSON.stringify(next));
    };

    const addCapture = async (): Promise<void> => {
        const video = document.querySelector<HTMLVideoElement>(videoSelector);
        if (video === null) {
            setMessage({ severity: 'error', text: '再生中の映像を取得できません。' });
            return;
        }
        try {
            const blob = await captureVideoFrame(video);
            setCaptures(current => {
                const selectedCount = current.filter(item => item.selected).length;
                const next = [
                    {
                        id: Date.now(),
                        blob,
                        url: URL.createObjectURL(blob),
                        selected: selectedCount < MAX_SELECTED_CAPTURE_COUNT,
                    },
                    ...current,
                ];
                if (next.length <= MAX_CAPTURE_COUNT) return next;
                next.slice(MAX_CAPTURE_COUNT).forEach(item => URL.revokeObjectURL(item.url));
                return next.slice(0, MAX_CAPTURE_COUNT);
            });
            setActiveTab('capture');
            setMessage({ severity: 'success', text: '現在の映像をキャプチャしました。' });
        } catch (error) {
            setMessage({ severity: 'error', text: error instanceof Error ? error.message : String(error) });
        }
    };

    const toggleCapture = (id: number): void => {
        setCaptures(current => {
            const selectedCount = current.filter(item => item.selected).length;
            return current.map(item => (item.id === id && (item.selected || selectedCount < MAX_SELECTED_CAPTURE_COUNT) ? { ...item, selected: !item.selected } : item));
        });
    };

    const deleteCapture = (id: number): void => {
        setCaptures(current => {
            const target = current.find(item => item.id === id);
            if (target !== undefined) URL.revokeObjectURL(target.url);
            return current.filter(item => item.id !== id);
        });
    };

    const copyCapture = async (capture: TwitterCapture): Promise<void> => {
        try {
            if (!window.isSecureContext || navigator.clipboard?.write === undefined || typeof ClipboardItem === 'undefined') {
                throw new Error('Clipboard API unavailable');
            }
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': capture.blob })]);
            setMessage({ severity: 'success', text: 'キャプチャをクリップボードへコピーしました。' });
        } catch {
            setMessage({
                severity: 'warning',
                text: '画像を直接コピーできませんでした。ダウンロードして利用してください。',
            });
        }
    };

    const downloadCapture = (capture: TwitterCapture): void => {
        const link = document.createElement('a');
        link.href = capture.url;
        link.download = `NeoEPGStation-${new Date(capture.id).toISOString().replace(/[:.]/g, '-')}.png`;
        link.click();
    };

    const disconnectedContent = (): ReactNode => {
        if (twitterStatus.isLoading || blueskyStatus.isLoading || misskeyStatus.isLoading) {
            return (
                <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress size={30} />
                </Stack>
            );
        }
        return (
            <Stack spacing={1.5} sx={{ p: 2, flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                    <Twitter sx={{ fontSize: 42 }} />
                    <BlueskyIcon sx={{ fontSize: 38 }} />
                    <MisskeyIcon sx={{ fontSize: 38 }} />
                </Stack>
                <Typography variant="subtitle1">SNSアカウントが連携されていません</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    視聴者プロフィールごとにアカウントを連携すると、このパネル内で検索・タイムライン表示・投稿を利用できます。
                </Typography>
                {(twitterStatus.isError || blueskyStatus.isError || misskeyStatus.isError) && (
                    <Alert severity="error">{twitterStatus.error?.message ?? blueskyStatus.error?.message ?? misskeyStatus.error?.message}</Alert>
                )}
                <Button
                    variant="contained"
                    startIcon={<SettingsOutlined />}
                    onClick={() => {
                        window.location.href = withBasePath('/settings');
                    }}
                >
                    SNS連携を設定
                </Button>
            </Stack>
        );
    };

    const captureContent = (): ReactNode => (
        <Stack spacing={1.5} sx={{ p: 2 }}>
            <Button variant="contained" startIcon={<AddAPhotoOutlined />} onClick={() => void addCapture()}>
                現在の映像をキャプチャ
            </Button>
            {captures.length === 0 ? (
                <Stack spacing={1} sx={{ py: 4, alignItems: 'center', color: 'text.secondary' }}>
                    <PhotoLibraryOutlined sx={{ fontSize: 44 }} />
                    <Typography variant="body2">キャプチャはまだありません。</Typography>
                </Stack>
            ) : (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 1,
                    }}
                >
                    {captures.map(capture => (
                        <Box
                            key={capture.id}
                            onClick={() => toggleCapture(capture.id)}
                            sx={{
                                position: 'relative',
                                overflow: 'hidden',
                                borderRadius: 1,
                                border: 2,
                                borderColor: capture.selected ? 'primary.main' : 'divider',
                                cursor: 'pointer',
                                aspectRatio: '16 / 9',
                                bgcolor: '#000',
                            }}
                        >
                            <Box component="img" src={capture.url} alt="映像キャプチャ" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            <Stack
                                direction="row"
                                sx={{
                                    position: 'absolute',
                                    right: 2,
                                    bottom: 2,
                                    bgcolor: 'rgba(0,0,0,.68)',
                                    borderRadius: 1,
                                }}
                            >
                                <Tooltip title="コピー">
                                    <IconButton
                                        size="small"
                                        sx={{ color: '#fff' }}
                                        onClick={event => {
                                            event.stopPropagation();
                                            void copyCapture(capture);
                                        }}
                                    >
                                        <ContentCopyOutlined fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title="ダウンロード">
                                    <IconButton
                                        size="small"
                                        sx={{ color: '#fff' }}
                                        onClick={event => {
                                            event.stopPropagation();
                                            downloadCapture(capture);
                                        }}
                                    >
                                        <DownloadOutlined fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title="削除">
                                    <IconButton
                                        size="small"
                                        sx={{ color: '#fff' }}
                                        onClick={event => {
                                            event.stopPropagation();
                                            deleteCapture(capture.id);
                                        }}
                                    >
                                        <DeleteOutlineOutlined fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                        </Box>
                    ))}
                </Box>
            )}
            <Typography variant="caption" color="text.secondary">
                青枠の画像を最大4枚まで選択できます。画像はブラウザ内だけに保持され、コピーまたはダウンロードできます。
            </Typography>
        </Stack>
    );

    const connectedContent = (): ReactNode => {
        if (activeTab === 'search') {
            return (
                <>
                    <Stack direction="row" spacing={1} sx={{ p: 1.25 }}>
                        <TextField
                            size="small"
                            fullWidth
                            label={`${socialTargetLabel(socialTarget)}を検索`}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') runSearch();
                            }}
                        />
                        <Button variant="contained" startIcon={<SearchOutlined />} disabled={query.trim().length === 0 || searchFetching} onClick={runSearch}>
                            検索
                        </Button>
                    </Stack>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, px: 1.25, pb: 1 }}>
                        {programTitle.length > 0 && (
                            <Chip
                                size="small"
                                clickable
                                label={programTitle}
                                onClick={() => {
                                    setQuery(programTitle);
                                    setSubmittedQuery(programTitle);
                                }}
                            />
                        )}
                        {channelName.length > 0 && (
                            <Chip
                                size="small"
                                clickable
                                label={channelName}
                                onClick={() => {
                                    setQuery(channelName);
                                    setSubmittedQuery(channelName);
                                }}
                            />
                        )}
                        {hashtags.map(hashtag => (
                            <Chip
                                key={hashtag}
                                size="small"
                                clickable
                                label={`#${hashtag}`}
                                onClick={() => {
                                    setQuery(`#${hashtag}`);
                                    setSubmittedQuery(`#${hashtag}`);
                                }}
                            />
                        ))}
                    </Box>
                    <Divider />
                    <TweetList
                        tweets={searchTweets}
                        loading={searchFetching}
                        error={searchError}
                        emptyMessage={submittedQuery.trim().length === 0 ? '検索キーワードを入力してください。' : '一致するポストはありません。'}
                    />
                </>
            );
        }
        if (activeTab === 'timeline') {
            return (
                <>
                    <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 1, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            ホーム
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            size="small"
                            onClick={() => {
                                if (usesTwitter && twitterConfigured) void twitterTimeline.refetch();
                                if (usesBluesky && blueskyConfigured) void blueskyTimeline.refetch();
                                if (usesMisskey && misskeyConfigured) void misskeyTimeline.refetch();
                            }}
                            disabled={timelineFetching}
                        >
                            更新
                        </Button>
                    </Stack>
                    <TweetList tweets={timelineTweets} loading={timelineFetching} error={timelineError} emptyMessage="ホームタイムラインに表示できるポストはありません。" />
                </>
            );
        }
        return captureContent();
    };

    return (
        <Box
            sx={{
                height: '100%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.paper',
            }}
        >
            <Tabs
                value={activeTab}
                onChange={(_, value: TwitterInnerTab) => setActiveTab(value)}
                variant="fullWidth"
                sx={{
                    minHeight: 42,
                    borderBottom: 1,
                    borderColor: 'divider',
                    '& .MuiTab-root': { minHeight: 42, px: 0.5, fontSize: '0.75rem' },
                }}
            >
                <Tab value="search" icon={<SearchOutlined />} iconPosition="start" label="検索" />
                <Tab value="timeline" icon={<HomeOutlined />} iconPosition="start" label="タイムライン" />
                <Tab value="capture" icon={<PhotoLibraryOutlined />} iconPosition="start" label={`キャプチャ ${selectedCaptures.length}/4`} />
            </Tabs>
            {anySocialConfigured && (
                <Stack direction="row" sx={{ px: 1.25, py: 0.75, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                    <Button
                        size="small"
                        color="inherit"
                        onClick={event => setAccountMenuAnchor(event.currentTarget)}
                        startIcon={selectedTargetIcon}
                        sx={{ minWidth: 0, textTransform: 'none' }}
                    >
                        {socialTargetLabel(socialTarget)}
                    </Button>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 0.5 }}>
                        {socialTarget === 'twitter'
                            ? `@${twitterStatus.data?.account?.screenName ?? ''}`
                            : socialTarget === 'bluesky'
                              ? `@${blueskyStatus.data?.account?.handle ?? ''}`
                              : socialTarget === 'misskey'
                                ? `@${misskeyStatus.data?.account?.username ?? ''}@misskey.io`
                                : socialTarget === 'twitter-bluesky'
                                  ? '両方をまとめて表示・投稿'
                                  : '連携済みSNSをまとめて表示・投稿'}
                    </Typography>
                    <Menu anchorEl={accountMenuAnchor} open={accountMenuAnchor !== null} onClose={() => setAccountMenuAnchor(null)}>
                        {twitterConfigured && (
                            <MenuItem selected={socialTarget === 'twitter'} onClick={() => selectSocialTarget('twitter')}>
                                <Twitter fontSize="small" sx={{ mr: 1 }} />
                                Twitter @{twitterStatus.data?.account?.screenName ?? ''}
                            </MenuItem>
                        )}
                        {blueskyConfigured && (
                            <MenuItem selected={socialTarget === 'bluesky'} onClick={() => selectSocialTarget('bluesky')}>
                                <BlueskyIcon fontSize="small" sx={{ mr: 1 }} />
                                Bluesky @{blueskyStatus.data?.account?.handle ?? ''}
                            </MenuItem>
                        )}
                        {misskeyConfigured && (
                            <MenuItem selected={socialTarget === 'misskey'} onClick={() => selectSocialTarget('misskey')}>
                                <MisskeyIcon fontSize="small" sx={{ mr: 1 }} />
                                Misskey.io @{misskeyStatus.data?.account?.username ?? ''}
                            </MenuItem>
                        )}
                        {twitterConfigured && blueskyConfigured && (
                            <MenuItem selected={socialTarget === 'twitter-bluesky'} onClick={() => selectSocialTarget('twitter-bluesky')}>
                                <Stack direction="row" spacing={0.25} sx={{ mr: 1 }}>
                                    <Twitter fontSize="small" />
                                    <BlueskyIcon fontSize="small" />
                                </Stack>
                                Twitter + Bluesky
                            </MenuItem>
                        )}
                        {configuredCount >= 2 && !(configuredCount === 2 && twitterConfigured && blueskyConfigured) && (
                            <MenuItem selected={socialTarget === 'all'} onClick={() => selectSocialTarget('all')}>
                                <Stack direction="row" spacing={0.15} sx={{ mr: 1 }}>
                                    {twitterConfigured && <Twitter fontSize="small" />}
                                    {blueskyConfigured && <BlueskyIcon fontSize="small" />}
                                    {misskeyConfigured && <MisskeyIcon fontSize="small" />}
                                </Stack>
                                連携済みSNSすべて
                            </MenuItem>
                        )}
                    </Menu>
                </Stack>
            )}
            <Box sx={{ minHeight: 120, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {anySocialConfigured || activeTab === 'capture' ? connectedContent() : disconnectedContent()}
            </Box>
            <Divider />
            <Stack spacing={1} sx={{ p: 1.5, bgcolor: 'background.default' }}>
                {message !== null && (
                    <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.75rem' } }}>
                        {message.text}
                    </Alert>
                )}
                <Stack direction="row" spacing={0.75}>
                    <TextField size="small" fullWidth placeholder="#ハッシュタグ" value={hashtagText} onChange={event => setHashtagText(event.target.value)} />
                    <Button size="small" variant="outlined" disabled={hashtags.length === 0} onClick={saveHashtags}>
                        保存
                    </Button>
                </Stack>
                {savedHashtags.length > 0 && (
                    <Box sx={{ display: 'flex', maxHeight: 58, overflowY: 'auto', flexWrap: 'wrap', gap: 0.5 }}>
                        {savedHashtags.map(hashtag => (
                            <Chip
                                key={hashtag}
                                size="small"
                                label={`#${hashtag}`}
                                onClick={() => setHashtagText(current => `${current} #${hashtag}`.trim())}
                                onDelete={() => removeSavedHashtag(hashtag)}
                            />
                        ))}
                    </Box>
                )}
                <TextField
                    multiline
                    minRows={2}
                    maxRows={4}
                    fullWidth
                    placeholder="ポスト"
                    value={tweetText}
                    onChange={event => setTweetText(event.target.value)}
                    onKeyDown={event => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && selectedTargetConfigured && composedText.length > 0 && remaining >= 0) {
                            postTweet.mutate();
                        }
                    }}
                />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Button size="small" startIcon={<AddAPhotoOutlined />} onClick={() => void addCapture()}>
                        キャプチャ
                    </Button>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color={remaining < 0 ? 'error' : remaining <= 20 ? 'warning.main' : 'text.secondary'}>
                        {remaining}
                    </Typography>
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={selectedTargetIcon}
                        endIcon={<SendOutlined />}
                        disabled={!selectedTargetConfigured || composedText.length === 0 || remaining < 0 || postTweet.isPending}
                        onClick={() => postTweet.mutate()}
                    >
                        ポスト
                    </Button>
                </Stack>
                {selectedCaptures.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                        選択中のキャプチャは自動添付されません。コピーまたはダウンロードして利用できます。
                    </Typography>
                )}
            </Stack>
        </Box>
    );
}

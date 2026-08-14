const ALLOWED_VIEWER_PROFILE_PASSWORD = /^[\x21-\x7E\u3001-\u303F\u3040-\u30FF\u31F0-\u31FF\uFF01-\uFF60\uFF61-\uFF9F\p{Script=Han}]+$/u;

export function normalizeViewerProfilePassword(value: string): string {
    return value.normalize('NFC');
}

export function viewerProfilePasswordError(value: string): string | null {
    const normalized = normalizeViewerProfilePassword(value);
    if (normalized.length === 0) return '連携パスワードを入力してください';
    if (/\p{White_Space}/u.test(normalized)) return '空白は使用できません';
    if (/\p{Extended_Pictographic}/u.test(normalized)) return '絵文字は使用できません';
    if (!ALLOWED_VIEWER_PROFILE_PASSWORD.test(normalized)) {
        return '英数字・一般的な記号・日本語だけを使用できます';
    }
    return null;
}

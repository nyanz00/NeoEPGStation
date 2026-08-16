# NeoEPGStation

NeoEPGStationは、EPGStation v2.10.0とEPGStation-nyanzを基に、フロントエンドをVue2からReactへの完全移行、録画・再生・エンコード機能の拡張、視聴者プロフィール、Annict・SNS連携、サーバー監視などを追加したフォークです。

現段階ではWindowsでしか動作確認を行っていませんが、LinuxおよびDockerでの動作確認もいずれ行います。

この文書は、epgstation-nyanzとNeoEPGStationで追加・変更した内容を一つにまとめたものです。


## 動作環境

- Node.js: `^20.19.0 || ^22.13.0 || >=24.11.0`
- 動作確認済み: 20.20.2 / 22.23.0 / 24.18.0
- windows10 / windows11
- データベース: MariaDB/MySQL、better-sqlite3
- WindowsでのFFmpeg、QSVEncC、NVEncC、Amatsukaze連携

Node.js 20、22、24とwindows10/11ではビルド、起動、基本操作を確認済みです<br>
linuxでも動く可能性はありますが、現状はテスト環境がすぐに用意出来ないため検証できていません<br>
今後またlinuxでの動作を検証する予定です<br>
また、windowsでは個人的な動作確認は行っていますが、完璧な動作を保証することはできません。データは必ずバックアップを取ってから使用するようにしてください

## インストールとビルド

### npm

```powershell
npm run all-install
npm run update-tsreadex
npm run build
npm start
```
tsreadexは放映中タブでリアルタイム視聴に使用するために必要です。コマンドを使わなくても、手動で取得してきてEPGStation\thirdparty\tsreadexに直接配置しても構いません。

### pnpm

ルートと`client`を一つのworkspaceとしてインストールできます。

```powershell
pnpm install
pnpm run update-tsreadex
pnpm run build
pnpm start
```

`npm`と`pnpm`のどちらでも構築できます。検証環境を頻繁に作り直す場合は、依存パッケージを共有ストアから再利用するpnpmの方が短時間で完了します。

## Windowsサービス

管理者権限のPowerShellで実行します。

```powershell
npm run install-win-service
```

アンインストール:

```powershell
npm run uninstall-win-service
```

Windowsサービス名と表示名はNeoEPGStationです。旧epgstation-nyanzサービスはnpm run uninstall-win-service-legacyで削除できます。

## 主な変更点

### Reactへの完全移行

- Vue2系は2023年12月にEoLしているため、フロントエンドをReactへ移行
- EPGStation2.10.0に存在していたwebUIの機能をおそらくほぼ全て移植
- 旧`/recorded/streaming/:id`を新しい再生URLへ自動変換
- 初回Socket.IO接続失敗、API取得失敗、部分成功した一括操作などのエラー表示と再取得を改善


### webUIのカスタマイズ性の向上

- favicon、PWA、iOSホーム画面アイコンを、NeoEPGStation、nyanzTV、オリジナルから選択可能
- webUIの差し色を選択するテーマカラー機能を追加
- カスタムテーマ色ではカラーピッカーまたはHEX値で指定可能
- ライトモードの視認性を高める設定を追加
- カスタムCSS機能を追加
- サイドメニューの並び替え機能と不要なメニューの非表示機能を追加


### チャンネル・放映中

- Mirakurun-nyanzの`GR-ALT1`から`GR-ALT20`までの追加チャンネル種別へ対応
- 全体的に放映中タブのUIを刷新
- ライブストリームを同一条件の視聴者間で共有し、不要なエンコーダー多重起動を抑制
- プレイヤーを新共通プレイヤーへ変更
- ios26でライブ視聴が強制停止される問題を回避

### 番組表

- 全波、GR、BS、CS、追加放送波を選択できる放送波セレクターを追加
- Mirakurunの局ロゴを表示し、`channelLogo`へキャッシュ
- 検索ボックスから局名で絞り込み機能を追加
- 通常・ダークテーマそれぞれについて、ARIB大ジャンル別の番組色を自由に設定する機能を追加
- Mirakurun初回EPG取得時の大量eventによる番組表欠落を補正するEPG event burst処理を追加
- 10分で10000件以上のEPG eventを検知した場合、30分後にmirakurunのapi/programsを取得し、EPGの補正を行う

### 検索・予約・ルール

- 放送局名を直接入力して絞り込める機能を追加
- ルール一覧へ予約有無とユーザーのフィルターを追加
- ルール編集時の自動検索と、設定に応じた検索結果への自動スクロール
- キーワードから保存先サブディレクトリを自動設定
- 録画済み重複回避、エンコード設定、エンコード後の元ファイル削除の既定値を設定可能
- 手動予約・ルール作成・アップロードで一時的に所有ユーザーを選択可能
- 番組予約をチャンネル・開始日時・終了日時へ切り替える時刻指定予約を復元
- 予約、スキップ、競合、重複の一括解除で、それぞれ正しい解除APIを使用

### 録画中

- 録画開始後に録画途中の映像からサムネイルを生成
- drop、error、scramblingを現在値として更新表示
- 録画途中ファイルを残して停止する操作と、録画情報・ファイルを削除する操作を分離
- 途中停止やエラーでもファイルが残った場合に、必要な後処理を実行可能

### 録画済み管理

- ファイル種別、drop、error、scramblingの有無などの録画済み検索条件を追加
- 編集モードで複数録画の所有ユーザーを一括変更する機能を追加
- 複数録画を既存または新規サブディレクトリへ一括移動する機能を追加
- ファイル移動またはDB更新失敗時に、移動済みファイルを元へ戻す
- クリーンアップ実行時に即時削除されないよう変更

クリーンアップは次の手順で動作します。

1. DB未登録ファイル、実ファイルがないDB項目、drop log、thumbnailを検査
2. `data/cleanup/recorded-cleanup-*.txt`へ候補を書き出す
3. 利用者がファイルを確認し、残したい行を削除
4. WebUIで候補ファイルを読み込み、最終確認後に残った行だけ実行

### WEB視聴とプレイヤー

- DPlayerを基にしたNeoEPGStation共通プレイヤー
- QSVEncC、NVEncC、VCEEncC、FFmpegからWeb視聴用エンコーダーを選択可能に
- 画質プロファイル、既定画質、HEVCエンコード、低遅延設定を設定可能
- `config.yml`で独自の画質プロファイルを追加可能
- TSおよびエンコード済み録画のHLS STREAMINGを改善
- 同一ストリームの共有、開始セグメント待ち、終了時のプロセス解放を改善
- PLAY／STREAMINGで録画ファイル内の字幕を優先順位に従って自動選択
- PLAYはlibassまたはDPlayer danmakuによる字幕表示を選択可能
- STREAMINGはFFmpeg/libassで字幕を焼き込み
- STREAMING字幕の大きさ、文字不透明度、縁取り幅、縁取り不透明度を調整可能に
- TS STREAMING時はNX-Jikkyoのライブコメントと録画時刻に対応する過去ログをdanmaku表示するように
- ライブ視聴ではプレイヤー下部からニコニコ実況へコメント投稿
- モバイルでの操作を全体的に改善

Apple系WebKitでは、MKV内のHEVC/AACを再エンコードせずMP4へ一時リマックスし、PLAYで再生します。iPhone・iPad向けには自動再生制限に対応する互換モードを用意しています。

### リジューム再生と視聴履歴

- PLAY／STREAMINGの再生位置をユーザーごとに保存
- `master`は個人用の再生位置・視聴履歴を保存しない
- 視聴履歴の保存有無と最大件数をユーザーごとに設定可能
- 履歴からPLAY／STREAMINGを再開可能に
- 履歴から対象録画が存在する録画済み一覧のページへ移動

### ユーザーと視聴者プロフィール

- 録画、予約、ルールの所有者・表示フィルター・外部連携用EPGStationユーザー
- `master`は全ユーザーの情報を表示
- ブラウザごとにアクティブユーザーを保存
- 一時的なユーザー選択ではアクティブユーザーを変更しない
- 既存ユーザーへ任意の視聴者プロフィールを紐付け
- 視聴者プロフィール単位でAnnict・SNSなどの外部資格情報を暗号化保存
- 個人の判断でロックが必要無い場合、外部資格情報を含んでいてもロックをかけないことも可能
- 共有環境では英数字もしくは日本語の連携パスワードで保護
- 回復コードを使ったサーバー上の安全なパスワード再設定
- 回復コードも失った場合は、外部資格情報だけを消去して再連携可能
- 所有する録画・予約・ルールがないユーザーは、本人へ切り替えた状態で削除可能

`data/viewer-profiles/credential.key`を失うと、保存済みの外部資格情報を復号できません。

### Annict連携

- Annict作品を年、クール、新作・再放送ごとに一覧表示出来るアニメタブを追加
- 受信可能局と曜日を選んで検索・ルール作成
- 複数作品の一括選択、一括ルール作成、一括「見た」記録
- 放送予定が未登録の作品も、作品名だけの全局・全曜日ルールを作成可能
- ルール/EPGStation上での視聴状態とAnnictの視聴状態を連携させる機能を追加
- 作品ID、実際の放送局、EPG開始日時を使ってAnnict Programと照合し、Annict上での視聴状態を自動で管理
- 視聴したユーザー本人のAnnictへ書き込み、録画ルール所有者のAnnictは変更しない
- 未選択・見たい・視聴中断の作品で未記録episodeを見た場合は`watching`へ移行
- 最終話視聴後の作品`watched`化と、予約が残っていないルールの自動無効化を個別設定
- Annict API失敗時は録画・再生を止めず、DBへ保存した再試行状態から後で同期

Annict読み取りトークンはサーバー共通、書き込みトークンは視聴者プロフィール単位です。

### SNS・ニコニコ実況連携

視聴画面のSNSパネル内で、現在の視聴者プロフィールに連携したサービスを利用します。

- Twitter: Netscape形式Cookieで連携し、検索、ホームタイムライン、投稿
- Bluesky: ハンドルとApp Passwordで連携し、検索、タイムライン、投稿
- Misskey.io: MiAuthで連携し、検索、タイムライン、ノート投稿
- 複数SNSのタイムライン・検索結果を日時順で統合
- 複数SNSへ同時投稿し、一部失敗時は成功側を維持して警告
- ニコニコ実況: Cookieで連携し、対応チャンネルへコメント投稿
- コメント受信は未連携でもNX-Jikkyoを利用可能

Twitterはインストール済みChromeをサーバー側から利用するため、Xの画面構造変更やCookie失効の影響を受ける場合があります。

### エンコードとAmatsukaze

- `type: amatsukaze`を追加し、直接`AmatsukazeAddTask.exe`へ投入、サーバーと通信
- 共通Amatsukaze設定とプリセットごとのprofile設定
- GUI TCP pushからpending、進捗、console、成功、失敗を取得
- push切断後の再接続とAmatsukaze側状態の再照合
- 出力安定待ち、suffix確定、一時出力ディレクトリから最終保存先への移動
- CP932／Shift_JIS、Unicode正規化、重複追加、キャンセル、pending timeoutへ対応
- EPGStationから直接起動したQSVEncC／NVEncCなどの標準出力から進捗を取得
- エンコード失敗時コマンドと、エンコーダー最終メッセージを出力する関数を追加
- ルール予約で放送局ごとのエンコードモードを指定
- 手動エンコード、手動予約、ルール予約でサムネイル再生成を選択
- Web画面から、実行中を固定したまま待機キューをドラッグまたは上下ボタンで並べ替え
- 編集中にキューが変化した場合は409で保存を拒否し、古い順序による上書きを防止
- エンコード待機キューをDBへ保存し、service再起動後に復元
- 待機中タスクは復元し、実行中だったAmatsukazeタスクはAmatsukaze側と照合
- 内蔵エンコーダーの中断タスクは、旧プロセスが動いていないことを確認してから先頭から再実行

Amatsukazeの具体的な設定例は`config/config-win32.yml.template`を参照してください。

### Discord通知

- 設定タブからDiscord webhookに通知を送信する機能を追加
- 録画開始、録画終了、録画失敗、エンコード成功、エンコード失敗を通知
- 同じタスクの同じイベントで複数ルールに一致した場合は、一覧で最も上のルールだけを使用
- 番組名、局名、録画ID、drop類、エンコードモード、エンコーダー最終メッセージを本文へ展開
- Webhook URLは暗号化保存し、APIやログへ返さない

### システム画面

旧ストレージ画面を、サーバー監視を含むシステム画面へ拡張しました。

- recordedストレージの総容量、使用量、空き容量
- ストレージ内の録画データ、ドロップログ、サムネイル、その他の容量内訳を表示
- CPU、GPU、メモリ、NeoEPGStationプロセス、OS稼働時間
- recorded以外の固定・リムーバブル・ネットワークストレージ
- operator、service、EPG updaterのログを画面内で表示
- ログ種別、表示行数、文字列検索を指定
- エンコードログはservice選択時だけ表示
- Mirakurunの接続状態、応答時間、バージョン、チューナー使用状況、利用者、選局中チャンネルを表示

### Tailscale MagicDNS HTTPS

手動で証明書を用意せず、Tailnet内からブラウザ警告なしのHTTPS接続を利用できます。

- `tailscale status --json`からMagicDNS FQDNを自動取得
- `tailscale cert`で初回証明書と秘密鍵を自動取得
- 既定では`data/tls/tailscale/`へ保存
- 証明書のホスト名、有効期限、秘密鍵との組み合わせを検証
- 有効期限前に一時ファイルへ再取得して無停止更新
- 更新失敗時は有効な旧証明書を継続使用
- HTTPポートを残した併用も可能

設定例は`config/config.yml.template`または`config/config-win32.yml.template`を参照してください。

### データベース・依存関係

- `sqlite3`から`better-sqlite3`へ移行
- MariaDB/MySQLは従来どおり`dbtype: mysql`を使用
- SQLiteとMySQLの両方へ、視聴者プロフィール、資格情報、セッション、Annictリンク、episode対応、視聴済み、リジューム、視聴履歴、エンコードキューのmigrationを追加
- MirakurunクライアントをWindows対応forkの4.1.3系へ更新
- npmに加えてpnpm workspaceへ対応
- OpenAPI定義とTypeScript型を追加機能へ追従
- 予約・エンコードの共有ロックを例外時にも必ず解放
- 内部IPCの要求IDをUUID化し、同一ミリ秒の要求衝突を防止
- 録画終了時にファイルストリームの完了を待ってから移動・サイズ取得
- 外部コマンドキューが1件の例外で停止し続ける問題を修正
- アップロード先とサブディレクトリが録画ルート外へ出ないよう境界検証
- ffmpeg・エンコーダー停止時に終了を待ち、必要に応じてプロセスツリーを強制終了

## Web視聴品質の設定

構造化された`watch`設定を使用すると、ライブと録画STREAMINGで共通の品質プロファイルを利用できます。

```yaml
watch:
    enabled: true
    encoder: QSVEncC
    qsvEncC: C:\qsvenc\QSVEncC64.exe
    defaultLiveQuality: 720p
    defaultRecordedQuality: 720p
    liveQualities:
        - 1080p
        - 720p
        - 480p
        - 軽量
    recordedQualities:
        - 1080p
        - 720p
        - 480p
        - 軽量
    qualities:
        軽量:
            width: 960
            height: 540
            videoBitrate: 2500K
            videoBitrateMax: 3500K
            audioBitrate: 160K
            is60fps: false
```

省略時の既定値やHEVC用プロファイルは設定テンプレートを参照してください。

## DBバックアップと復元

NeoEPGStationの通常バックアップ:

```powershell
npm run backup backup.json
```

通常バックアップには、録画・予約・ルールなどの従来データに加えて、次のNeoEPGStation固有データを含みます。

- EPGStationユーザーと視聴者プロフィール
- Annictルール・録画episode・ユーザー別視聴状態
- リジューム位置と視聴履歴
- 暗号化されたAnnict資格情報
- 暗号化されたDiscord通知設定

Twitter、Bluesky、Misskey.io、ニコニコのCookie・セッションは通常バックアップへ含めません。復元後に再連携してください。

Annict資格情報とDiscord Webhookを復号するには、バックアップ元と同じ`data/viewer-profiles/credential.key`が必要です。安全上の理由から、通常バックアップへ`credential.key`自体は同梱しません。DBバックアップと鍵は別々に安全な場所へ保管してください。

本家EPGStation v2.10.0へ戻すための互換バックアップ:

```powershell
node dist/DBTools.js -m backup -o backup-legacy.json --compatible
```

または:

```powershell
node dist/DBTools.js -m backup -o backup-legacy.json --backup-type legacy
```

エンコードキューは現在の実行環境に属する一時状態であるため、JSONバックアップには含めません。SQLite
DBファイルをそのまま別環境へコピーした場合も、インストール先識別が異なるキューは自動実行しません。

## 既存環境からの移行

1. 既存環境のDB、`config`、`data`をバックアップ
2. NeoEPGStationの依存関係をインストールしてビルド
3. 既存の設定とデータを配置
4. NeoEPGStationを起動し、SQLiteまたはMariaDBのmigrationを適用
5. 番組表、録画済み、予約、ルール、録画、再生を確認
6. 外部連携を使用する場合は、`data/viewer-profiles/credential.key`が正しいことを確認

同じMariaDBデータベースへ旧EPGStationとNeoEPGStationを同時接続しないでください。テスト環境ではDBを複製して使用してください。


## 既知の制約

- `1.0.0-beta.2`時点ではWindowsを中心に検証しており、LinuxおよびDockerの最終確認は未実施です。
- 実機依存のチューナー、GPU、エンコーダー、字幕、局構成は環境差が大きいため、本番導入前に短い録画で確認してください。
- Twitter連携はWeb版XのCookieと画面構造へ依存するため、X側の変更で動作しなくなる可能性があります。
- ニコニコ実況、NX-Jikkyo、Annict、Bluesky、Misskey.ioなど外部サービスの障害・仕様変更時は、一部機能を利用できない場合があります。
- Annictで未来のepisodeが未登録、または話数・局・日時から一意に特定できない場合は、誤登録防止のため保留されます。
- iOS／iPadOSの自動再生可否はWebKitのバージョンと、そのサイトに対する利用者操作履歴の影響を受けます。
- カスタムCSSで画面を操作できなくなった場合は、URLの`disable-custom-css=1`で一時無効化できます。

## バグ修正

- 検索時刻の`start ～ range`を編集後、ルール修正に失敗する問題を修正
- URL scheme設定で新しめのバージョンのブラウザを使用していると`PROTOCOL://`のコロンが欠落する問題を修正

## 主な確認済み項目

- Windows 10 / Windows 11でのインストール、ビルド、起動
- npmおよびpnpm workspaceでの依存インストールとビルド
- better-sqlite3の新規・既存DB migration
- 実MariaDBでの既存DB migration、録画、アカウント連携
- Mirakurun接続、EPG更新、番組表、検索、予約、録画、ルール更新
- 録画中サムネイルと録画済み引き継ぎ
- PLAY、STREAMING、ライブ視聴
- QSVEncC／NVEncCを使用したWeb視聴
- MKVのApple WebKit向けMP4リマックス
- PLAYの複数ASS／SRT字幕、STREAMING字幕焼き込み
- NX-Jikkyoライブ・過去ログコメント
- Amatsukaze投入、待機、進捗、完了、失敗、キャンセル、再接続
- エンコードキュー並べ替えとDBからの復元
- ユーザー別ルール、予約、録画、リジューム、視聴履歴
- Annictルール、episode照合、手動・自動視聴記録
- Twitter、Bluesky、Misskey.io、ニコニコのアカウント連携
- Discord通知の暗号化保存と条件別送信
- Tailscale証明書の自動取得とHTTPS接続
- システム画面のCPU、メモリ、複数GPU、ストレージ、ログ、Mirakurun監視


## あとがき
このプロジェクトも素人がcodexを使用して作成しているため、有識者が見たらおかしいところがあるかもしれません。

Windows環境では日常利用に必要な主要機能を最低限確認していますが、実践的な大規模な確認はまだ取れていないため、利用によって生じた不利益の責任を取ることは出来ません。

導入前に必ず各種データをバックアップし、実環境のチューナー・エンコーダー・字幕構成で確認してから使用してください。LinuxおよびDockerの検証完了後、beta表記を外した正式版を目指します。

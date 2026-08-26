# NeoEPGStation

NeoEPGStationは、[EPGStation v2.10.0](https://github.com/l3tnun/EPGStation)とEPGStation-nyanzを基にしたフォークです。Web
UIをVue 2からReactへ移行し、録画・再生・エンコード・外部サービス連携・サーバー管理を拡張しています。

テレビ番組の検索・予約・録画・視聴というEPGStation本来の機能を維持しながら、PCとモバイルの両方で扱いやすいWeb
UI、字幕・コメント対応プレイヤー、ユーザー別の視聴管理、Amatsukaze連携、システム監視などを追加しています。

> [!IMPORTANT]
>
> 導入・更新前にDB、`config.yml`、`data/viewer-profiles/credential.key`など必要なデータを必ずバックアップしてください。同じDBへ旧EPGStationとNeoEPGStationを同時接続しないでください。

詳細な変更点、設定例、既知の制約は[NeoEPGStationドキュメント](doc/neoepgstation.md)を参照してください。

## スクリーンショット

<!--
撮影後、下記のプレースホルダーを画像へ差し替える想定です。
推奨保存先: doc/images/readme/
個人名、IPアドレス、保存パス、外部連携アカウントなどの写り込みを確認してください。
-->

|               ダッシュボード                |                      番組表                      |
| :-----------------------------------------: | :----------------------------------------------: |
| **画像: `doc/images/readme/dashboard.png`** |     **画像: `doc/images/readme/guide.png`**      |
|  録画状況や最近の録画、予約をまとめて確認   | 放送波の切り替え、局名検索、ジャンル色設定に対応 |

|                 アニメ録画支援                 |                      録画済み管理                      |
| :--------------------------------------------: | :----------------------------------------------------: |
|    **画像: `doc/images/readme/anime.png`**     |       **画像: `doc/images/readme/recorded.png`**       |
| Annictの作品情報と放送候補から録画ルールを作成 | 詳細検索、一括編集、ファイル移動、クリーンアップに対応 |

|                  Webプレイヤー                  |                    システム情報                     |
| :---------------------------------------------: | :-------------------------------------------------: |
|    **画像: `doc/images/readme/player.png`**     |      **画像: `doc/images/readme/system.png`**       |
| 字幕・文字スーパー・danmaku・音量ブーストに対応 | CPU、メモリ、GPU、ストレージ、ログ、Mirakurunを確認 |

<!-- モバイル表示を独立して見せたい場合は、次の1枚も追加する。 -->
<!-- ![モバイル表示](doc/images/readme/mobile.png) -->

## 主な機能

### React Web UI

- PC、タブレット、スマートフォンに対応したレスポンシブUI
- ライト／ダークテーマ、テーマカラー、カスタムCSS
- サイドメニューの並び替えと表示項目の選択
- favicon、PWA、iOSホーム画面アイコンの切り替え
- 一覧のページ、検索条件、スクロール位置を可能な範囲で保持

### 番組検索・予約・録画

- 番組表、キーワード検索、手動予約、ルール予約
- 予約の競合、重複、スキップ状態の表示と一括操作
- 放送局、所有ユーザー、ファイル状態などによる絞り込み
- 録画中の進捗、drop、error、scrambling、サムネイルを更新表示
- 複数の録画済み番組に対する所有ユーザー変更、ファイル移動、削除
- DBと実ファイルの不整合を候補リストで確認してから実行するクリーンアップ

### アニメ録画支援・Annict連携

- Annict作品を年、クール、新作／再放送別に表示
- 受信可能な放送局と曜日を指定した放送候補検索
- 複数作品の録画ルールを一括作成
- EPG、録画、視聴状態とAnnict episodeの照合
- 視聴者ごとの「見た」記録と、失敗時の再同期

### Web視聴・プレイヤー

- 放送中番組のライブ視聴
- 録画済み番組のPLAY、TS STREAMING、ENCODED STREAMING
- ARIB字幕・文字スーパー、ASS／SRT字幕、FFmpegによる字幕焼き込み
- NX-Jikkyoのライブコメントと過去ログのdanmaku表示
- 字幕とdanmakuを含むスクリーンショット
- ユーザー別リジューム再生と視聴履歴
- 最大200%まで設定できる音量ブースト
- iPhone／iPad向けのWebKit再生モード

### エンコード・Amatsukaze

- FFmpeg、QSVEncC、NVEncC、VCEEncCによるWeb視聴用エンコード
- 画質プロファイル、HEVC、低遅延設定
- AmatsukazeAddTaskとTCP pushを使用した投入・進捗取得・キャンセル
- エンコード待機キューの並べ替えと再起動後の復元
- ルール、手動予約、手動エンコードからのモード選択
- Dockerなど、NeoEPGStationとAmatsukazeから異なるパスに見える環境のパスマッピング

### ユーザー・外部連携

- 録画、予約、ルール、視聴履歴を管理するEPGStationユーザー
- 外部資格情報を暗号化して保存する視聴者プロフィール
- Annict、Twitter、Bluesky、Misskey.io、ニコニコ実況との連携
- 録画・エンコード結果のDiscord通知

### システム管理

- CPU、メモリ、GPU、OS、NeoEPGStationプロセスの情報表示
- ストレージ容量と録画、サムネイル、ログなどの使用量内訳
- Operator、Service、EPG updaterのログ表示、検索、ログレベル変更
- Mirakurunの接続状態、応答時間、チューナー使用状況
- Web UIからの安定版／develop更新、更新前バックアップ、ビルド失敗時の自動復旧
- Tailscale MagicDNSを使用したHTTPS証明書の自動取得・更新

## 動作環境

### 必須

- Node.js `^20.19.0 || ^22.13.0 || >=24.11.0`
- [Mirakurun](https://github.com/Chinachu/Mirakurun)または[mirakc](https://github.com/mirakc/mirakc)
- [FFmpeg](https://ffmpeg.org/)
- 次のいずれかのデータベース
    - better-sqlite3（標準）
    - MySQL／MariaDB

録画TSからサービスを抽出してWeb視聴する場合は、tsreadexも必要です。

```console
npm run update-tsreadex
```

Linuxでは公式ソースをビルドするため、`git`、`make`、`g++`が必要です。

### 主な確認環境

- Windows 10／11
- Ubuntu 22.04
- Docker（Debian／Alpine）
- Node.js 20／22／24
- better-sqlite3、MariaDB／MySQL

環境ごとの確認範囲は[NeoEPGStationドキュメント](doc/neoepgstation.md#動作環境)を参照してください。

## セットアップ

- [Windowsセットアップ](doc/windows-setup.md)
- [Linux／macOSセットアップ](doc/linux-setup.md)
- [字幕表示／低遅延配信の設定](doc/caption-lowlatency-setup.md)
- [設定項目一覧](doc/conf-manual.md)

### npm

```console
npm run all-install
npm run update-tsreadex
npm run build
npm start
```

### pnpm

```console
pnpm install
pnpm run update-tsreadex
pnpm run build
pnpm start
```

Windowsでは、管理者権限のPowerShellからサービスとして登録できます。

```console
npm run install-win-service
```

## アップデート

Git clone環境では、Web UIの「システム」→「バージョン管理」から次の更新先を選択できます。

- `nyanz-master`の最新安定版タグ
- `develop`ブランチの最新コミット

Webアップデーターは更新前にDBと`config.yml`をバックアップし、必要な依存パッケージのインストールとビルドを実行します。ビルドに失敗した場合は更新前のコードへ自動復旧します。更新成功後は、画面に表示される再起動操作で新しいコードを反映してください。

コマンドラインから更新する場合は、使用しているパッケージマネージャーに合わせて実行します。

### npm

```console
git pull --ff-only
npm run all-install
npm run build
```

### pnpm

```console
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
```

依存関係ファイルに変更がないことを確認できる場合は、installを省略してビルドのみ実行できます。更新後はNeoEPGStationを再起動してください。

## バックアップと移行

DBの通常バックアップは次のコマンドで作成できます。

```console
npm run backup backup.json
```

通常バックアップには、録画、予約、ルール、視聴履歴などのDBデータが含まれます。録画ファイル、サムネイル、ログ、`config.yml`、`data/viewer-profiles/credential.key`は別途バックアップしてください。

視聴者プロフィールに保存した暗号化資格情報を復号するには、バックアップ元と同じ`data/viewer-profiles/credential.key`が必要です。このファイルを紛失した場合、保存済み資格情報は復元できません。

- [DBバックアップと復元の詳細](doc/neoepgstation.md#dbバックアップと復元)
- [既存環境からの移行](doc/neoepgstation.md#既存環境からの移行)
- [EPGStation v1からの移行](doc/v1migrate.md)

## ドキュメント

- [NeoEPGStationの機能と注意事項](doc/neoepgstation.md)
- [設定項目一覧](doc/conf-manual.md)
- [ログ設定](doc/log-manual.md)
- [Web API](doc/webapi.md)
- [Kodi連携](doc/kodi.md)
- [変更履歴](CHANGELOG.md)

## 注意事項

- このフォークは多数の独自機能を含みます。本番環境へ導入する前に、DBと設定をバックアップし、短い録画・再生・エンコードで確認してください。
- SQLiteとMySQL／MariaDBの両方にmigrationがありますが、更新前のバックアップを推奨します。
- チューナー、GPU、エンコーダー、字幕、放送局構成には環境差があります。
- 外部サービスの障害や仕様変更により、Annict、SNS、コメントなど一部機能が利用できなくなる場合があります。
- `nyanz-master`は確認済み安定版、`develop`は開発版です。

## Contributing

[CONTRIBUTING.md](.github/CONTRIBUTING.md)を参照してください。

## Credits

- Original project: [l3tnun/EPGStation](https://github.com/l3tnun/EPGStation)
- Tuner server: [Chinachu/Mirakurun](https://github.com/Chinachu/Mirakurun)

## License

[MIT License](LICENSE)

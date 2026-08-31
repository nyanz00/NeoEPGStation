# NeoEPGStation

[Mirakurun](https://github.com/Chinachu/Mirakurun)を利用した録画管理ソフト[EPGStation](https://github.com/l3tnun/EPGStation)とEPGStation-nyanzを基にしたフォークです。<br>
モバイルフレンドリーな操作感はそのままに、WebUIを刷新し、アニメ録画支援機能・Amatsukazeとの接続機能・字幕表示に対応した新プレイヤーなどNeo版独自の機能を追加しています。

> [!IMPORTANT]
>
> 導入・移行前にDBや`config.yml`などの必要なデータを必ずバックアップしてください。同じDBへ旧EPGStationとNeoEPGStationを同時接続しないでください。

詳細な変更点、設定例、既知の制約は[NeoEPGStationドキュメント](doc/neoepgstation.md)を参照してください。

## スクリーンショット

|                         ダッシュボード                          |                         番組表                          |
| :-------------------------------------------------------------: | :-----------------------------------------------------: |
| ![ダッシュボード](doc/images/readme/dashboard.png) | ![番組表](doc/images/readme/guide.png) |
|            録画状況や最近の録画、予約をまとめて確認             |  番組表タブ内で放送波/局名による絞り込みに対応、局ロゴ表示で視認性も向上   |

|                       アニメ録画支援                        |                            録画済み管理                             |
| :---------------------------------------------------------: | :----------------------------------------------------------------: |
| ![アニメ録画支援](doc/images/readme/anime.png) | ![録画済み管理](doc/images/readme/recorded.png) |
|       指定した年とクールのアニメ一覧をAnnictの作品情報から取得        |      ユーザー機能を追加し、録画を所有ユーザーごとにフィルタリング可能      |

|                     アニメ作品詳細                      |                         放送候補・ルール作成                          |
| :-----------------------------------------------------------: | :-----------------------------------------------------------------: |
| ![アニメ作品詳細](doc/images/readme/anime-detail-info.png) | ![放送候補・ルール作成](doc/images/readme/anime-detail-schedule.png) |
|              あらすじ、キャスト、スタッフ、作品情報を確認               |              annict内の放送予定から受信可能な局で検索や録画ルールを作成               |

|                          Webプレイヤー                           |                           システム情報                            |
| :-------------------------------------------------------------: | :---------------------------------------------------------------: |
| ![Webプレイヤー](doc/images/readme/player.png) | ![システム情報](doc/images/readme/system.png) |
|          プレイヤーをDplayerベースに変更し、mkv内の字幕再生に対応          |       ストレージだけでなくシステムリソースも確認可能、ログやMirakurunも      |

<!-- モバイル表示を独立して見せたい場合は、次の1枚も追加する。 -->
<!-- ![モバイル表示](doc/images/readme/mobile.png) -->

## 機能

### 放送番組の視聴・録画・管理

-   ブラウザでの Web インターフェイス操作
    -   番組表の表示
    -   番組検索
    -   番組単位の予約
        -   番組表からの手動予約
        -   ルールによる自動予約
        -   予約の競合や重複の警告
    -   番組の視聴
        -   放送中番組のライブ視聴
        -   [aribb24.js][] を使用する Web での字幕/文字スーパー表示機能
        -   [mpegts.js][] を使用する Web での[低遅延ライブ視聴機能](doc/caption-lowlatency-setup.md)
        -   録画済み番組のストリーミング視聴
        -   録画済み番組のダウンロード
-   API
    -   [WebAPI Document](doc/webapi.md)

[aribb24.js]: https://github.com/monyone/aribb24.js
[mpegts.js]: https://github.com/xqq/mpegts.js

### NeoEPGStationの大まかな変更点

- WebUIの刷新
  - テーマカラーの選択や、サイドメニューの並び替えなどWebUIのカスタマイズ性を向上
  - フロントエンドをVue 2からReactへ移行
- アニメ録画支援機能の追加
  - Annictと連携することで、指定した年とクールのアニメ一覧とその放送日時・局を取得し、予約ルールの作成を支援
  - Web上でのアニメ視聴を管理し、Annictでの視聴状態と連動
- ライブ視聴機能の改善
  - ライブ視聴機能に[tsreadex](https://github.com/xtne6f/tsreadex)を組み込み安定性を向上
  - NX-Jikkyoから実況コメントを取得し弾幕表示、アカウント連携でニコニコ実況にコメントする機能を追加
- 番組表の視認性・操作性を向上
  - 番組表の各カラムにMirakurunで取得した局ロゴと放送波種別を表示するように変更
  - 番組表タブ内で放送波種別や文字検索による絞り込み機能を追加
- Amatsukazeとの直接接続に対応
  - EPGStation側からAddTaskを使用してタスクを直接投入し、Amatsukaze serverとTCP接続することで進捗を管理
- Webプレイヤーの刷新
  - 共通Webプレイヤーを[tsukumijima版DPlayer](https://github.com/tsukumijima/DPlayer)をNeoEPGStation用に最適化したプレイヤーに変更
  - STREAMING視聴時のHLSをVOD HLS方式に変更し、プレイヤー制御やシーク精度を改善
  - JASSUBやDPlayerのdanmakuを使用し、mkv内の字幕やNicoJKコメント字幕のweb上での再生に対応
- ユーザー機能の追加
  - 各録画に対して所有ユーザーの概念を追加し、フィルタリング機能を向上
  - ユーザーごとに視聴履歴を保存する機能を追加し、リジューム再生にも対応
  - ユーザーに対して各SNSアカウントを連携しWebUI上でSNS投稿を可能に
- ストレージタブをシステムタブに拡充
  - システムタブ内でサーバーPCのリソースやストレージの内訳等を表示
  - システムタブ内からWeb上でNeoEPGStationのアップデートを実行可能に
- Tailscale MagicDNS HTTPSに対応
  - サーバーPCにTailscaleを導入し、config.ymlに三行追加するだけで簡単にHTTPS化、証明書の自動更新に対応
- Discord通知機能
  - Discordのwebhookを利用した通知機能をWebUI上から設定可能に
- Windowsを主な使用環境として対応
  - フォーク制作者の主な使用環境がWindowsであるため、Linuxでの動作確認も行っていますが主な対応環境はWindowsになります(linux環境で問題が出た場合でも対応はしますが!)


## 動作環境

### 必須

- Node.js `^20.19.0 || ^22.13.0 || >=24.11.0`
- [Mirakurun-nyanz](https://github.com/nyanz00/Mirakurun)または[Mirakurun](https://github.com/Chinachu/Mirakurun)（[mirakc](https://github.com/mirakc/mirakc)での動作は未確認です）
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

# EPGStation-nyanz

この文書は、EPGStation v2.10.0をベースにしたこのフォークの主な変更点、導入上の注意、既知の制約をまとめたものです。

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

## インストール・ビルド

```powershell
npm run all-install
npm run update-tsreadex
npm run build
```

## Windowsサービス

サービスをインストールする場合は、管理者権限のPowerShellで次のコマンドを実行してください

```powershell
npm run install-win-service
```

サービスをアンインストールする場合は、管理者権限のPowerShellで次のコマンドを実行してください

```powershell
npm run uninstall-win-service
```

インストールされるサービス名は`epgstation-nyanz`です。

## 主な変更点

### チャンネルと番組表

- Mirakurun-nyanzの`GR-ALT1`から`GR-ALT20`までのチャンネルタイプに対応
- 検索・ルール・番組表で追加放送波を扱えるように拡張
- 番組表を全波/GR/BS/CSなどで絞り込む放送波セレクターを追加
- 番組表ヘッダーへMirakurunの局ロゴを表示
- 取得済み局ロゴを`channelLogo`へキャッシュし、番組表ではキャッシュを利用
- チャンネル選択欄へ文字入力フィルターを追加。空白を無視して検索可能
- Mirakurunの初回起動時のEPG作成でevent数が多すぎる事によってEPGが穴開きになる問題を解決するため、EPG event burst機能を追加
- 10分で10000件以上のEPG eventを検知した場合、30分後にmirakurunのapi/programsを取得し、EPGの補正を行う

### Amatsukazeとエンコード

- `type: amatsukaze`を追加し、バッチファイルを介さず`AmatsukazeAddTask.exe`へ投入
- 共通設定をトップレベルの`amatsukaze`へ集約し、各プリセットではprofileだけを上書き可能
- 入力TSと同じベース名・出力拡張子のファイルを検出し、EPGStationのsuffix付き期待名へ確定
- Amatsukaze GUIと同じTCP push接続で進捗、最新console行、成功、失敗、pendingを取得
- Amatsukazeが100%になってから出力ファイル監視を開始し、suffixを追加する
- pending状態が一定時間続いた場合に自動キャンセル
- EPGStationからの停止をAmatsukazeへTCPで通知
- QSVEncC/NVEncCなど、直接起動したエンコーダーの標準出力から進捗を取得
- エンコード失敗時コマンド`encodingFailedCommand`を追加
- 手動エンコード、手動予約、ルール予約でサムネイル再生成を選択可能
- ルール予約で、放送局ごとにエンコードモードを割り当てる機能を追加

Amatsukazeはrigaya氏がフォークしているバージョンでのみ動作確認を行っております。設定例:

```yaml
amatsukaze:
    addTaskPath: C:\Amatsukaze\exe_files\AmatsukazeAddTask.exe
    root: C:\Amatsukaze
    ip: 127.0.0.1
    port: 32768
    priority: 3
    noMove: true
    outputDirMode: encode
    waitIntervalSec: 10
    finishDelaySec: 30
    stableSec: 30
    outputNameMatch: exact
    pendingTimeoutSec: 300

encode:
    - name: Amatsukaze VFR30
      type: amatsukaze
      suffix: -amvfr30.mkv
      rate: 4.0
      amatsukaze:
          profile: HIGH
```

`ip`と`port`はAmatsukaze ServerのGUI TCPポートです。REST API URLやpoll intervalの設定はありません。

### Web視聴とプレイヤー

- 放映中、録画STREAMING、録画PLAYをKonomiTV風の新プレイヤーへ移行(tsukumijima氏のDplayerを利用させていただいています)
- QSVEncC/NVEncC/VCEEncC/FFmpegからWeb視聴用エンコーダーを設定画面で選択
- ライブ視聴の既定画質、HEVC、M2TS-LL低遅延モードを設定画面から変更
- TS/encoded STREAMINGで連続VOD HLSセッションを実装し、セグメントごとにエンコーダーを再起動する方式を廃止
- 録画TSのSTREAMINGでARIB字幕を表示
- PLAYでMKV内の複数ASS/SRT字幕を選択し、JASSUBでオーバーレイ表示
- STREAMINGで選択した字幕をFFmpeg/libassを使用し、映像へ焼き込む機能を追加
- Nx-Jikkyoから放映中のライブ視聴中のコメントと、TS streaming時に録画時刻に対応する過去ログを取得
- 放映中と録画TS STREAMINGで実況コメントをDPlayer danmakuとして表示
- プレイヤーを画面に合わせて拡大するようにし、自動で左ナビゲーションバーを非表示に

Web視聴の構造化設定例:

```yaml
watch:
    enabled: true
    encoder: QSVEncC
    qsvEncC: C:\qsvenc\QSVEncC64.exe
    # nvEncC: C:\NVEnc\NVEncC64.exe
    # tsreadex: C:\tsreadex\tsreadex.exe
    defaultLiveQuality: 720p
    defaultRecordedQuality: 720p
    liveQualities:
        - 1080p
        - 720p
        - 480p
    recordedQualities:
        - 1080p
        - 720p
        - 480p
    hevc10bit: false
    fps24: false
```

`tsreadex`を省略すると`thirdparty/tsreadex/tsreadex.exe`を利用します。以下のコマンドで自動で取得します。

```powershell
npm run update-tsreadex
```


### ユーザー機能

- 録画所有者・表示フィルター用のユーザー機能を追加
- 設定画面の標準ユーザーをブラウザに保存
- ルール、手動予約、簡易予約、アップロード時に一時的なユーザーを選択可能
- 録画済み、予約、ルールをユーザーごとに表示
- master表示では全ユーザーを表示
- 録画済みの三点メニューから所有ユーザーを変更
- 既存DBのルール、予約、録画は初回マイグレーション時にuser 1へ割り当て

これはアクセス制御や認証ではありません。EPGStationへアクセスできる利用者はユーザー表示を切り替えられます。

### 検索・予約・UI

- ルール一覧へ予約有フィルターとユーザーフィルターを追加
- 手動予約・ルール予約へユーザーとサムネイル再生成を追加
- アップロードへユーザー、チャンネルフィルター、24時間表記時刻入力を追加
- reverse proxyと`clientSocketioPort`併用時にリアルタイム更新が止まる問題を修正
- 録画中のdrop/error/scramblingを現在値として表示
- ファイルタイプを複数選択して検索。`含む`は選択した全タイプを含む録画、`のみ`は選択タイプだけの録画を表示
- TS、drop、error、scrambling、元ファイル、手動録画で絞り込み
- 期間または年/月/日単位の日付指定検索
- THUMBボタンから任意の録画ファイルを元にサムネイル再生成
- snackbarが録画カードの三点メニューを塞がないよう配置を調整
- クリーンアップ実行時に即時削除されないよう変更

クリーンアップは次の手順で動作します。

1. DB未登録ファイル、実ファイルがないDB項目、drop log、thumbnailを検査
2. `data/cleanup/recorded-cleanup-*.txt`へ候補を書き出す
3. 利用者がファイルを確認し、残したい行を削除
4. WebUIで候補ファイルを読み込み、最終確認後に残った行だけ実行

サーバー側でも計画ファイルの場所、録画ディレクトリ、drop logディレクトリ、thumbnailディレクトリを再検証します。空でないディレクトリや、実ファイルが存在するDB項目は削除しません。

### DBと依存関係

- 各種パッケージをある程度更新
- sqlite3をbetter-sqlite3へ移行
- MariaDB/MySQLは従来通り`dbtype: mysql`を使用

## DBバックアップと互換性

通常のバックアップはユーザー情報や追加設定等の独自設定を保持します。

```powershell
npm run backup backup.json
```

本家EPGStation v2.10.0へ戻すための互換バックアップは、nyanz版で追加したユーザー情報と追加列を除外します。

```powershell
node dist/DBTools.js -m backup -o backup-legacy.json --compatible
```

同じ指定は`--backup-type legacy`でも可能です。nyanz版を別環境へ移す場合は既定の`full`を利用してください。MariaDBの同一DBへ複数のEPGStationを同時接続して運用しないでください。

## バグ修正

- 検索時刻の`start ～ range`を編集後、ルール修正に失敗する問題を修正
- URL scheme設定で新しめのバージョンのブラウザを使用していると`PROTOCOL://`のコロンが欠落する問題を修正

## 既知の制約

- DPlayerのdanmakuは環境によって左右にブレが発生するため、PLAYのコメント字幕はJASSUBを既定にしています
- JASSUB用日本語フォントを同梱するため、クライアント配布サイズが増えています
- STREAMINGの字幕焼き込みは再生中にオフへ切り替えられません。切り替える場合はストリームを作り直します
- Nx-Jikkyoのチャンネル対応表はKonomiTV由来です。対応表のライセンスは`src/model/api/channel/KonomiTV-LICENSE.txt`を参照してください
- `thirdparty/tsreadex`の実行ファイルは取得スクリプトまたは手動配置が必要です

## 確認済み項目

- Node.js 20.20.2 / 22.23.0 / 24.18.0でビルドと起動
- better-sqlite3とMariaDBでEPG更新、番組表、検索、予約、録画、ルール更新
- TypeORM 1.0環境で翌週ルール予約の追加
- Amatsukaze投入、進捗、失敗検知、pending、完了、キャンセル
- QSVEncC進捗表示
- 録画TS/エンコード済みファイルのSTREAMING
- PLAYの複数ASS字幕、NicoJK字幕
- 放映中と録画TSのNx-Jikkyoコメント
- ユーザー別ルール、予約、録画済み表示
- クリーンアップ計画の生成と最終確認

実機依存のエンコーダー、字幕、チャンネル構成は環境差が大きいため、本番導入前に短い録画で確認してください。

## あとがき
- このプロジェクトも素人がcodexを使用して作成しているため、有識者が見たらおかしいところがあるかもしれません。
- 元々は個人で使う用に作っていたのでwindowsでの動作のみを考えていましたが、思ったよりも変更点が多くなり、せっかくなのでmirakurunと合わせていずれlinuxでの動作検証もする予定です
- 今後、フロントエンドをreactに移行させて、windows用のクライアントアプリを作る予定です

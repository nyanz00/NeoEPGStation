# Linux / macOS 用 セットアップマニュアル

本マニュアルでは、Linux / macOS 環境におけるセットアップ手順を解説します

## セットアップ

1. **Node.js (20.19 以上の 20 系、22.13 以上の 22 系、または 24.11 以上), Mirakurun, FFmpeg/FFprobe, Python (2.7, v3.5, v3.6, or v3.7), GCC** がインストール済みであることを確認する

    ```bash
    $ node --version
    $ curl -o - http://<MirakurunURL>:<Port>/api/version
    $ ffmpeg -version
    $ python --version
    $ gcc --version
    ```

    FFmpeg/FFprobe についてデフォルトでは `/usr/local/bin/` にインストールされていると想定しています  
    違う場所にインストールされている場合は `config.yml` を修正してください

2. EPGStation のインストール

    ```bash
    $ git clone https://github.com/l3tnun/EPGStation.git
    $ cd EPGStation
    $ npm run all-install
    $ npm run build
    ```

3. 設定ファイルの作成

    ```bash
    $ cp config/config.yml.template config/config.yml
    $ cp config/operatorLogConfig.sample.yml config/operatorLogConfig.yml
    $ cp config/epgUpdaterLogConfig.sample.yml config/epgUpdaterLogConfig.yml
    $ cp config/serviceLogConfig.sample.yml config/serviceLogConfig.yml
    $ cp config/enc.js.template config/enc.js
    ```

4. 設定ファイルの編集

    - 詳細な設定は [詳細マニュアル](conf-manual.md) を参照

    ```yaml
    port: 8888
    mirakurunPath: 'http+unix://%2Fvar%2Frun%2Fmirakurun.sock/'
    ```

    Mirakurun が別ホストで動作している場合は `mirakurunPath: 'http://<MirakurunURL>:<Port>'`

## EPGStation の起動 / 終了

-   手動で起動する場合

    ```
    $ npm start
    ```

### 自動で起動する場合

#### systemd を利用する場合（Linux）

リポジトリには `scripts/systemd/neoepgstation.service` の unit ファイルが含まれています。以下の例では、EPGStation を `/opt/NeoEPGStation` に配置し、`epgstation` ユーザーで起動します。配置先や実行ユーザーが異なる場合は、unit 内の値を実環境に合わせてください。

```bash
$ command -v node npm pnpm
$ sudo install -m 644 scripts/systemd/neoepgstation.service /etc/systemd/system/neoepgstation.service
$ sudoedit /etc/systemd/system/neoepgstation.service
```

unit の `User`、`WorkingDirectory`、`ExecStart`、`PATH` を確認・編集します。`User` には既存の一般ユーザーを指定できます。そのユーザーが設定ファイル、データ、ログなどへアクセスできるようにしてください。`command -v node` で確認した Node.js のパスを `ExecStart` に設定し、`PATH` には Node.js と npm のディレクトリ、および pnpm を使う場合は pnpm のディレクトリも含めます。ログインシェルと systemd では `PATH` が異なることがあります。

```bash
$ sudo systemctl daemon-reload
$ sudo systemd-analyze verify /etc/systemd/system/neoepgstation.service
$ sudo systemctl enable --now neoepgstation
$ sudo systemctl status neoepgstation
$ sudo journalctl -u neoepgstation -f
```

`systemctl status` で状態を確認し、`journalctl` でログを確認できます。`journalctl` の追従表示は `Ctrl+C` で終了します。停止、再起動、自動起動登録の解除は次のコマンドを使います。

```bash
$ sudo systemctl stop neoepgstation
$ sudo systemctl restart neoepgstation
$ sudo systemctl disable --now neoepgstation
```

EPGStation の Web 更新を適用した後は、画面の再起動ボタン、または `systemctl restart` で再起動してください。unit は異常終了時に再起動しますが、`systemctl stop` による停止では再起動しません。

PM2 から systemd へ移行する場合は、二重起動を避けるため、先に PM2 のプロセスを停止・削除し、保存済みのプロセス一覧を更新してください。

```bash
$ pm2 stop epgstation
$ pm2 delete epgstation
$ pm2 save
```

#### PM2 を利用する場合

-   [pm2](http://pm2.keymetrics.io/) を利用して自動起動設定が可能です
-   初回のみ以下の起動設定が必要です

```
$ sudo npm install pm2 -g
$ sudo pm2 startup <OS名>
$ pm2 start dist/index.js --name "epgstation"
$ pm2 save
```

-   手動で終了する場合

    起動したターミナルで `Ctrl+C` を押します。

-   自動起動した EPGStation を終了する場合

    ```
    $ pm2 stop epgstation
    ```

-   自動起動登録した EPGStation を削除する場合

    ```
    $ pm2 delete epgstation
    ```

## MySQL 使用時の注意

EPGStation 使用中は MySQL のバイナリログが大量に生成されてディスクを圧迫するので、MySQL の設定を変えることを推奨します

```
expire_logs_days = 1
```

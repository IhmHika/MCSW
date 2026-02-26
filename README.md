# MCWS
マイクラBE版（統合版）のチャットを Discord と双方向で連携させる Bot です。
各自の PC で実行して、自分のワールドや友達のワールドを Discord と繋ぐことができます。
## 主な機能
マイクラ内のチャットとディスコードのテキストチャンネルを連携
ディスコード側からマイクラ側へ遠隔でのコマンド実行

## 準備するもの
Node.js  https://nodejs.org/ja/download
Discord Bot   https://discord.com/developers/applications

## 使い方
1. 設定ファイルの作成
config.json を右クリックして編集し、各項目を入力してください。
TOKEN: Bot のトークン
CHANNEL_ID: 送信先のチャンネル ID
CLIENT_ID: Bot のアプリケーション ID
GUILD_ID: サーバーの ID
ADMIN_IDS: 管理者のユーザー ID (例: ["123456789"])

2. セットアップ (初回のみ)
setup.bat をダブルクリックして、ライブラリをインストールします。

3. 起動
start.bat をダブルクリックして Bot を起動します。

4. マイクラとの接続
Discord で /start コマンドを打ちます。
マイクラ内で /connect localhost:19132 と入力します。

## 注意
/connect を実行したプレイヤーの周囲のチャットしか取得できない場合があります。全員分取得したい場合は、ホスト（サーバー主）が接続することをお勧めします。

自由に変更可
自作発言、二次配布不可

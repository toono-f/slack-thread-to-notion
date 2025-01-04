// 現在の仕様だと、スレッドの最初のメッセージに絵文字リアクションをつけることで、そのメッセージに紐づくスレッド内のメッセージが全てNotionに書き込まれる。
// （スレッドの最初のメッセージと投稿日付が異なる）スレッド途中のメッセージに絵文字リアクションをつけた場合、テキスト内容が正しくNotionに書き込まれない。

const targetEmoji = "notion"; // 追跡する絵文字に置き換える

// eslint-disable-next-line
function doPost(e) {
  // Slackからのリクエストを解析
  const params = JSON.parse(e.postData.contents);

  // SlackからのURL検証リクエストを処理
  if (params.type === "url_verification") {
    return ContentService.createTextOutput(params.challenge);
  }

  // 絵文字リアクションが追加された場合
  if (params.event && params.event.type === "reaction_added") {
    const reaction = params.event.reaction;

    if (reaction === targetEmoji) {
      // prettier-ignore
      // eslint-disable-next-line
      const slackToken = PropertiesService.getScriptProperties().getProperty("SLACK_TOKEN");

      // Slack APIを使って該当のメッセージとスレッドを取得
      const channelId = params.event.item.channel;
      const messageTs = params.event.item.ts;
      const messageResponse = UrlFetchApp.fetch(
        `https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&limit=1&inclusive=true`,
        {
          method: "get",
          headers: {
            Authorization: `Bearer ${slackToken}`,
          },
        }
      );
      const messageData = JSON.parse(messageResponse.getContentText())
        .messages[0];

      // スレッドのメッセージを取得
      const threadTs = messageData.thread_ts || messageTs;
      const threadResponse = UrlFetchApp.fetch(
        `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}`,
        {
          method: "get",
          headers: {
            Authorization: `Bearer ${slackToken}`,
          },
        }
      );
      const threadMessages = JSON.parse(
        threadResponse.getContentText()
      ).messages;

      // Notionに書き込むデータを準備
      const data = threadMessages.map((msg) => ({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: msg.text,
              },
            },
          ],
        },
      }));

      // 絵文字リアクションが追加されたテキストの投稿日付をUTCからJSTに変換
      const postDate = new Date(messageData.ts * 1000 + 9 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]; // 日付をYYYY-MM-DD形式に変換

      // データベースIDを取得
      // prettier-ignore
      // eslint-disable-next-line
      const databaseId = PropertiesService.getScriptProperties().getProperty("NOTION_DATABASE_ID");

      // Notion APIトークンを取得
      // prettier-ignore
      // eslint-disable-next-line
      const notionToken = PropertiesService.getScriptProperties().getProperty("NOTION_TOKEN");

      // 重複チェックのための検索クエリを実行
      const searchResponse = UrlFetchApp.fetch(
        "https://api.notion.com/v1/databases/" + databaseId + "/query",
        {
          method: "post",
          headers: {
            Authorization: `Bearer ${notionToken}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
          },
          payload: JSON.stringify({
            filter: {
              and: [
                {
                  property: "name",
                  title: {
                    equals: threadMessages[0].text,
                  },
                },
                {
                  property: "date",
                  date: {
                    equals: postDate,
                  },
                },
              ],
            },
          }),
        }
      );

      const searchResults = JSON.parse(searchResponse.getContentText());

      // 重複が見つかった場合は処理を中止
      if (searchResults.results.length > 0) {
        return ContentService.createTextOutput("Duplicate entry found");
      }

      // 重複がない場合のみ、以下の既存のコードを実行
      const notionRequestBody = {
        parent: { database_id: databaseId },
        properties: {
          name: {
            title: [
              {
                text: {
                  content: threadMessages[0].text, // スレッドの最初のメッセージをタイトルとして使用
                },
              },
            ],
          },
          date: {
            date: {
              start: postDate, // 日付
              end: null, // 今回は終了日付は不要
            },
          },
          status: {
            status: {
              name: "未着手", // ステータス
            },
          },
        },
        children: data, // テキスト
      };

      // Notion APIにリクエストを送信
      UrlFetchApp.fetch("https://api.notion.com/v1/pages", {
        method: "post",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        payload: JSON.stringify(notionRequestBody),
      });
    }
  }

  return ContentService.createTextOutput("OK");
}

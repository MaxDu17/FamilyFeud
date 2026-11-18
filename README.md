# Family Feud — Family Game Night

A Family Feud–style game show for your family party, with a blue-and-gold studio, illuminated answer board, oval title badge, and Fast Money round. It runs in a web browser with no internet and no installs. One window is the **operator console** (on the laptop); the other is the **audience screen** (on the TV or projector).

The studio artwork and fonts are bundled locally. Snow and holiday string lights are off by default; you can still enable them in **Look & Sound**. Existing custom titles, questions, scores, and audio selections are preserved. The previous stock titles update to “Family Feud” and “Fast Money.”

## Quick start

1. Double-click **`operator.html`**. Chrome works best; Safari works too.
2. Click **Open audience screen**. Drag the new window onto the TV, then click inside it once to make it full screen.
3. Use the **Title** screen and **▶ Theme music** while people settle in, then click **Start Round 1**.

The **How to Run** tab in the operator console walks through every step of a round.

> Connect the TV as an *extended* display, not mirrored, so only you see the operator console. Set the Mac's sound output (System Settings → Sound) to the TV or speaker. All sound plays from the operator window.

## Putting in your survey results

There are two options:

- **In the app:** go to **Setup & Questions**, edit the text, and click **Save questions**. It checks your input and previews the rounds as you type.
- **In a file:** open `survey-data.js` in any text editor, replace the sample questions, save, and reload `operator.html`.

The format is plain text:

```
[x1] Name something people bring to a holiday potluck.
Casserole, 31
Cookies, 24
Pie, 17

[x2] Name something you might find in a stocking.
Candy, 40
Socks, 18

[sudden] Name something people do on New Year's Eve.
Countdown, 44
Kiss, 23

[fast] Name a winter sport.
Skiing, 41
Snowboarding, 22
```

- A line that **doesn't** end in a number starts a new question. Answer lines end with the number of people who gave that answer.
- A comma, tab, `|` or space before the number all work, so you can paste two columns straight from a spreadsheet.
- Answers are sorted automatically. Up to 8 fit on the board.
- Tags: `[x1]` `[x2]` `[x3]` set the point multiplier, `[sudden]` marks a tiebreaker (only the #1 answer counts, triple points), and `[fast]` marks a bonus-round question (use 5).
- **Print host sheet** prints every question and answer so the host can read from paper.

The sample file has 4 main rounds (×1, ×1, ×2, ×3), a sudden-death tiebreaker, and 5 bonus questions. Delete or add rounds as you like.

## Scoring rules (same as the TV format)

- **Face-off:** one player from each team buzzes in. The higher-ranked answer wins control, and that team chooses to play or pass.
- **Play:** the controlling team keeps answering. Every revealed answer, including the face-off answers, adds *points × multiplier* to the round bank. A wrong answer is a strike.
- **Three strikes:** the other team gets one steal guess. If it's on the board, they win the whole bank plus that answer. If not, the playing team gets the bank.
- **Clearing the board** before 3 strikes wins the bank automatically.
- **Winning:** the first team to **300** wins by default. Change this in Setup, or set it to 0 to play every round and have the highest score win.
- **Bonus round:** two players, 5 questions, 20 and 25 seconds. A duplicate answer gets the "try again" sound. Reaching **200** combined triggers the win celebration.

Made a mistake? **Undo** (⌘Z) steps back one action, and you can type over either score in the sidebar.

## Keyboard shortcuts (operator)

| Key | Action |
| --- | --- |
| `1`–`8` | Reveal that answer |
| `X` | Wrong answer / strike / steal failed |
| `Q` / `P` | Left / right team buzzed in |
| `Space` | Start/pause the bonus timer |
| `D` | Bonus-round duplicate sound |
| `⌘Z` / `Ctrl+Z` | Undo |

## Swapping the background and sounds

Open the **Look & Sound** tab in the operator console:

- **Background:** click **Choose image…** and pick any picture. A wide 16:9 image looks best. Use **Darken** and **Blur** so the board stays readable, and switch the falling snow and string lights on or off. **Use default background** undoes it.
- **Sounds:** every sound (theme music, correct answer, wrong answer, buzz-in, applause, timer and more) has its own row. Click **▶** to preview, **Replace…** to pick your own mp3/m4a/wav, **Reset** to go back to the built-in sound, and use the slider to set that sound's volume (all the way left turns it off).

Picked files are remembered in this browser, so you only set them up once. The live preview in the sidebar shows changes right away.

**Folder option**, handy if you move the game to another computer:
- Put `background.jpg` (or `.png` / `.webp`) in the `images/` folder.
- Put audio files in `sounds/` using the names listed in [`sounds/README.txt`](sounds/README.txt), for example `theme.mp3`, `reveal.mp3`, `wrong.mp3`.
- Reload the page, or click **Rescan sounds folder**.

Files picked in the app take priority over folder files, and anything you don't replace uses the built-in version. The built-in music and effects (including an original theme tune) are synthesized in the browser, so the game works offline with no audio files at all.

## Good to know

- The game saves to the browser as you play, so an accidental refresh won't lose scores. Click **Setup & Questions → New game** to start fresh.
- If you edit `survey-data.js` after saving questions in the app, click **Reload from survey-data.js** to switch back to the file.
- Picked backgrounds and sounds are stored in the browser you picked them in. If you switch browsers or computers, pick them again or use the folder option.
- **Popup blocked?** Allow popups for the page, then click Open audience screen again.
- **Audience screen says "Waiting for the operator"?** Close it and reopen it with the button in the operator console.
- **No sound?** Click anywhere in the operator window once (browsers need a click before playing audio), and check the Mute box and your Mac's sound output.

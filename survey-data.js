/*
 * ============================================================
 *  YOUR SURVEY QUESTIONS GO HERE
 * ============================================================
 *  Edit the text between the two backticks (`) below, save the file,
 *  then reload the operator page. (You can also edit questions inside
 *  the operator page under "Setup & Questions".)
 *
 *  FORMAT
 *  - A line that does NOT end in a number starts a new question.
 *  - Each answer goes on its own line:   Answer text, points
 *    (a comma, tab, "|" or just a space before the number all work,
 *     so you can paste two columns straight from a spreadsheet)
 *  - Answers are sorted by points automatically. Max 8 per board.
 *  - Optional tag at the start of a question:
 *        [x1]  single points (default)
 *        [x2]  double points
 *        [x3]  triple points
 *        [sudden]  sudden-death tiebreaker (only the #1 answer counts, triple points)
 *        [fast]    a bonus-round question (use 5 of them)
 *  - If a question itself ends in a number, start it with "Q:".
 *  - Lines starting with # are ignored. Don't use the backtick character.
 *
 *  The questions below are SAMPLES with made-up numbers -
 *  replace them with your real survey results.
 * ============================================================
 */
window.SURVEY_DATA = `
# ---------- MAIN GAME ----------

[x1] Name something people bring to a holiday potluck.
Casserole, 31
Cookies, 24
Pie, 17
Wine, 11
Salad, 8
Ham, 5

[x1] Name a reason you might leave a holiday party early.
Too tired, 34
Had too much to drink, 21
Boring, 16
Another party, 12
Babysitter, 9
Bad weather, 5

[x2] Name something you might find in a stocking.
Candy, 40
Socks, 18
Gift card, 14
Coal, 11
Orange, 7

[x3] Name a popular holiday movie.
Home Alone, 33
Elf, 27
It's a Wonderful Life, 15
A Christmas Story, 12
The Grinch, 9

# Only played if the game is tied at the end:
[sudden] Name something people do on New Year's Eve.
Countdown, 44
Kiss, 23
Drink champagne, 18
Make resolutions, 9

# ---------- BONUS ROUND (5 questions) ----------

[fast] Name a winter sport.
Skiing, 41
Snowboarding, 22
Ice skating, 17
Hockey, 12
Sledding, 6

[fast] Name a holiday drink.
Eggnog, 45
Hot chocolate, 26
Cider, 13
Mulled wine, 9
Champagne, 5

[fast] Name one of Santa's reindeer.
Rudolph, 48
Dasher, 15
Prancer, 12
Blitzen, 10
Comet, 8

[fast] Name something you shovel.
Snow, 72
Dirt, 13
Food, 8
Manure, 5

[fast] Name a New Year's resolution.
Lose weight, 39
Exercise more, 24
Save money, 15
Eat healthier, 12
Quit smoking, 6
`;

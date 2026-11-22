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

[x1] Name a robot incident encountered while conducting research
Robot part breaking / wearing out, 14
Fire, smoke, overheating, 8
Getting hurt by robot, 5
Broke an object / committed warcrimes, 5
Robot ignored E-stop, 2
Getting cat-called a "clanker keeper", 1

[x1] Name a Robotics Startup
Physical Intelligence, 15
Figure, 8
Sunday, 7
Generalist, 5
Figure AI, 3
Sharpa, 3

[x2] Name an influential paper
Attention is All you Need, 24
Diffusion Policy, 10
ALOHA, 7
UMI, 6
Pi0, 3
Behavioral Prompting, 1


[x3] Name a meme or brainrot content.
67, 18
Skibdi Toilet, 15
Ligma / Sugondese, 10
Tung Tung Tung Sahur, 5
Big Chungus, 5
Amogus, 3


# ---------- BONUS ROUND (5 questions) ----------

[fast] Type of nut
Walnut, 7
Cashew, 3
Peanut, 3
Hazelnut, 2
Macadamia, 2
Pecan, 2

[fast] Graphics Card
RTX 5090, 6
RTX Pro 6000, 4
A100, 2
GPU, 2

[fast] Christmas song
All I Want for Christmas Is You, 10
Jingle Bells, 6
Jingle Bell Rock, 2
Last Christmas, 2
Winter Wonderland, 2
Rudolph, 2

[fast] Hard robotics concept
Manipulation, 10
Control, 8
Flow Matching, 6
Sim2Real, 3 
ROPE, 1

[fast] Holiday food / drink
Hot Chocolate, 18
Potato Dish, 8
Turkey, 8
Eggnog, 4
Pie, 4

[fast] Robot arm.
Franka, 22
ARX, 8
Sawyer, 6
Universal Robotics, 6

[fast] Santa's Reindeer.
Rudolph, 25
Vixen, 3
Cupid, 2
Dasher, 2
Donner, 2
`;

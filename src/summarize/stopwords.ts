/**
 * Compact stopword lists. They do two jobs: detect the document language, and keep
 * function words out of keywords and sentence similarity. Want your language? Add a list here.
 */

const EN = `a about above after again against all almost alone along already also although always am among an and another any anybody anyone anything anyway are aren't around as at back be became because become becomes been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't done down during each either else enough etc even ever every everyone everything few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's however i i'd i'll i'm i've if in into is isn't it it's its itself just least less let's like made make many may me might more most mostly much must mustn't my myself neither no nor not now of off often on once one only or other others otherwise ought our ours ourselves out over own per perhaps quite rather really same shall shan't she she'd she'll she's should shouldn't since so some something sometimes still such than that that's the their theirs them themselves then there there's therefore these they they'd they'll they're they've this those though through thus to together too toward towards under until up upon us very via was wasn't we we'd we'll we're we've well were weren't what what's whatever when when's where where's whether which while who who's whom whose why why's will with within without won't would wouldn't yet you you'd you'll you're you've your yours yourself yourselves`;

const FR = `a à afin ai aie aient ainsi alors as au aucun aucune auquel aura aurai auraient aurais aurait auras aurez auriez aurions aurons auront aussi autre autres aux auxquelles auxquels avaient avais avait avant avec avez aviez avions avoir avons ayant ayez ayons c ça car ce ceci cela celle celles celui cependant certain certaine certaines certains ces cet cette ceux chacun chacune chaque chez ci comme comment d dans de des desquelles desquels dès donc dont du duquel elle elles en encore entre es est et étaient étais était étant été êtes étiez étions être eu eue eues eûmes eurent eus eusse eussent eut eux fait faire fais faut fois font furent fus fut ici il ils j je jusqu jusque l la laquelle le lequel les lesquelles lesquels leur leurs lors lorsque lui m ma mais me même mêmes mes moi mon n ne ni non nos notre nous on ont or ou où par parce parmi pas pendant peu peut peuvent plus plusieurs pour pourquoi pourtant puis qu quand que quel quelle quelles quels qui quoi s sa sans se sera serai seraient serais serait seras serez seriez serions serons seront ses si sien sienne soi soient sois soit sommes son sont sous soyez soyons suis sur t ta te tel telle telles tels tes toi ton tous tout toute toutes très tu un une unes uns vers voici voilà vos votre vous y`;

const ES = `a al algo algunas algunos ante antes aquel aquella aquellas aquellos aquí así aun aunque cada como con contra cual cuales cuando cuanto de del desde donde dos e el ella ellas ello ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estaban estado estamos estan están estar estas este esto estos estoy fue fueron fui fuimos ha había habían haber hace hacen hacer hacia han has hasta hay he la las le les lo los más me mi mis mismo mucho muchos muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que qué quien quienes se sea ser si sí sido siempre sin sobre sois solo somos son soy su sus también tan tanto te tenemos tener tengo ti tiene tienen todo todos tu tus un una unas uno unos vosotros y ya yo`;

const DE = `aber alle allem allen aller alles als also am an ander andere anderen anderer anderes auch auf aus bei bin bis bist da dadurch daher damit dann das dass daß dein deine dem den denn der deren des dessen deshalb die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines einige er es etwas euch euer eure für gegen gewesen hab habe haben hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre im in indem ins ist jede jedem jeden jeder jedes jener jetzt kann kein keine können könnte machen man manche mehr mein meine mich mir mit muss musste nach nicht nichts noch nun nur ob oder ohne sehr sein seine sich sie sind so solche soll sollte sondern sonst über um und uns unser unter viel vom von vor wann war waren warum was weil weiter welche welchem welchen welcher welches wenn wer werde werden wie wieder will wir wird wo wurde wurden zu zum zur zwar zwischen`;

const IT = `a ad agli ai al alla alle allo anche ancora avere aveva avevano c che chi ci come con cosa così cui da dai dal dalla dalle degli dei del della delle dello di dove e è ed era erano essere gli ha hanno ho i il in io la le lei li lo loro lui ma mi mia mie miei mio ne negli nei nel nella nelle no noi non nostra nostre nostri nostro o ogni per perché più poi possono può quale quali quando quanto quella quelle quelli quello questa queste questi questo se sei si sia siamo sono sta stato su sua sue sui sul sulla suo suoi tra tu tua tue tuo tutti tutto un una uno vi voi`;

const PT = `a à ao aos as às até com como da das de dela dele deles depois do dos e é ela elas ele eles em entre era eram essa essas esse esses esta estas este estes eu foi foram há isso isto já lhe lhes mais mas me mesmo meu minha muito na nas nem no nos nós num numa o os ou para pela pelas pelo pelos por qual quando que quem se sem ser seu seus sua suas só também te tem têm teu tua um uma umas uns você vocês`;

/** Words that are not stopwords grammatically but make poor keywords. */
const GENERIC: Record<string, string> = {
  en: `able across actually add added allow allows almost already another anything around based become begin best better big called case cases certain change clear come comes common completely consider could day days different does done early easy end enough especially even example examples fact far feel find first follow following found four full general give given go going good great group hand hard help high however idea important include including instead keep kind know known large last later lead least left less let level life likely line little long look lot low main make makes making many matter mean means might moment much need needs never new next number numbers often old open order part particular people place point possible put rather real really result right said say says second see seem seems set several short show shows side simple simply since small something sometimes start still take takes tell than thing things think three time times today true try turn two type up use used useful uses using usually various want way ways well whole work works world year years`,
  fr: `aujourd avoir bien beaucoup bon cas certains chose choses comme déjà deux dire doit donc encore enfin ensemble exemple faire fait façon fin grand grande hui jour jours lieu manière moins moment monde mot non nouveau nouvelle partie peu peut plupart point possible premier première prendre presque quelque quelques rien seulement simple sorte souvent temps tous trois trop vraiment`,
  es: `ahora año años bien caso cosa cosas día días dos ejemplo forma gran hacer manera mejor momento mundo parte puede tiempo tres vez veces`,
  de: `beispiel dabei gibt jahr jahre kommt mal neue neuen schon sehen sein teil viele wurde zeit`,
  it: `anni anno caso cose esempio fare giorno modo parte poco tempo volta`,
  pt: `ano anos caso coisa coisas dia dias exemplo fazer forma parte pode tempo vez vezes`,
};

const LISTS: Record<string, string> = { en: EN, fr: FR, es: ES, de: DE, it: IT, pt: PT };

export const LANGUAGES = Object.keys(LISTS);

const cache = new Map<string, Set<string>>();

/** Pure grammatical stopwords (used for language detection). */
export function grammarStopwords(lang: string): Set<string> {
  const key = `g:${lang}`;
  let set = cache.get(key);
  if (!set) {
    set = new Set((LISTS[lang] ?? EN).split(/\s+/).filter(Boolean));
    cache.set(key, set);
  }
  return set;
}

/** Stopwords + generic filler for keyword extraction. English filler is always included: tech docs mix languages. */
export function stopwordsFor(lang: string): Set<string> {
  const key = `s:${lang}`;
  let set = cache.get(key);
  if (!set) {
    set = new Set([
      ...grammarStopwords(lang),
      ...grammarStopwords('en'),
      ...(GENERIC[lang] ?? '').split(/\s+/),
      ...GENERIC.en.split(/\s+/),
    ]);
    set.delete('');
    cache.set(key, set);
  }
  return set;
}

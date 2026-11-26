'use strict';
// Interface language (English / French).
// The app is written in English; in French mode every text the page shows (including messages,
// banners, confirmation dialogs and canvas labels via tr()) is translated as it appears.
// Your own content (titles, captions, file names) is never translated.
(function () {
  const KEY = 'lang';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  const lang = saved === 'en' || saved === 'fr' ? saved : (String(navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en');
  document.documentElement.lang = lang;

  const FR = {
    // ---- top bar, welcome ----
    'Stream to Shorts': 'Stream to Shorts',
    '＋ Import video': '＋ Importer une vidéo',
    'Analyze video': 'Analyser la vidéo',
    'Re-analyze': 'Réanalyser',
    'Render ▾': 'Rendu ▾',
    'This clip': 'Ce clip',
    'Selected clips': 'Clips cochés',
    'New & outdated only': 'Nouveaux et obsolètes seulement',
    'All clips': 'Tous les clips',
    '⚡ Quick draft of this clip': '⚡ Brouillon rapide de ce clip',
    '10 s, low quality, ready in seconds': '10 s, basse qualité, prêt en quelques secondes',
    'Tasks': 'Tâches',
    'Turn a long stream into Shorts': 'Transformez un long stream en Shorts',
    'Pick a video': 'Choisissez une vidéo',
    ': drop it into the': ' : déposez-la dans le dossier',
    'folder or use': 'ou utilisez',
    'Import video': 'Importer une vidéo',
    'Analyze': 'Analysez',
    ': the app scans the audio and on-screen action and suggests the strongest moments.': ' : l\'app analyse le son et l\'action à l\'écran, et propose les meilleurs moments.',
    'Adjust': 'Ajustez',
    ': trim each clip, set titles, place the facecam and gameplay, choose the caption style.': ' : coupez chaque clip, ajoutez les titres, placez la facecam et le jeu, choisissez le style des sous-titres.',
    'Render': 'Lancez le rendu',
    ': get vertical 9:16 MP4s with animated captions in the': ' : obtenez des MP4 verticaux 9:16 avec sous-titres animés dans le dossier',
    'folder.': '.',
    'Each video is its own project: its clips, captions, word fixes and exports never mix with another video\'s. Switch between videos at any time; each one keeps its progress and your place.':
      'Chaque vidéo est un projet à part : ses clips, sous-titres, corrections de mots et exports ne se mélangent jamais avec ceux d\'une autre vidéo. Passez de l\'une à l\'autre quand vous voulez : chacune garde sa progression et l\'endroit où vous en étiez.',
    'Continue': 'Continuer',
    'Start project': 'Commencer',
    'Choose a video…': 'Choisir une vidéo…',
    'No videos yet. Put a video in the': 'Aucune vidéo pour l\'instant. Mettez une vidéo dans le dossier',
    'folder or click': 'ou cliquez sur',

    // ---- clips panel, transport, timeline ----
    'Clips': 'Clips',
    '＋ Add': '＋ Ajouter',
    '✦ Auto-detect': '✦ Détection auto',
    'Select all': 'Tout cocher',
    'Play clip': 'Lire le clip',
    'Loop': 'Boucle',
    'Snap to speech': 'Caler sur la parole',
    'Video size': 'Taille de la vidéo',
    'Drag empty space: new clip · drag a clip: move · scroll: zoom ·': 'Glisser dans le vide : nouveau clip · glisser un clip : déplacer · molette : zoom ·',
    'all shortcuts (?)': 'tous les raccourcis (?)',
    'No clips yet.': 'Aucun clip pour l\'instant.',
    'Click': 'Cliquez sur',
    ',': ',',
    ', or drag across the timeline to make one.': ', ou glissez sur la timeline pour en créer un.',
    'Untitled clip': 'Clip sans titre',
    'Untitled': 'Sans titre',
    'Analyze the video to see loudness and action here': 'Analysez la vidéo pour voir ici le volume et l\'action',
    'new clip': 'nouveau clip',
    'pause in speech': 'pause dans la parole',
    'end of a sentence': 'fin de phrase',
    'quiet moment': 'moment calme',
    'Snapped to a': 'Calé sur une',

    // ---- tabs ----
    'Edit clip': 'Modifier le clip',
    'Layout': 'Disposition',
    'Style': 'Style',
    'Captions & AI': 'Sous-titres et IA',
    'Exports': 'Exports',

    // ---- edit clip ----
    'Select a clip on the left, or click': 'Sélectionnez un clip à gauche, ou cliquez sur',
    'Title, line 1': 'Titre, ligne 1',
    'Title, line 2 (highlight colour)': 'Titre, ligne 2 (couleur d\'accent)',
    'Layout for this clip': 'Disposition de ce clip',
    'Project default': 'Celle du projet',
    'Facecam + Gameplay': 'Facecam + jeu',
    'Gameplay only': 'Jeu seulement',
    'Facecam only': 'Facecam seulement',
    'Style for this clip': 'Style de ce clip',
    'Project style': 'Style du projet',
    'Start': 'Début',
    'End': 'Fin',
    '−1s': '−1 s',
    '+1s': '+1 s',
    '⇤ playhead': '⇤ tête de lecture',
    'playhead ⇥': 'tête de lecture ⇥',
    'Burn captions into this clip': 'Incruster les sous-titres dans ce clip',
    'Fix a word in all clips…': 'Corriger un mot dans tous les clips…',
    'Generate captions': 'Générer les sous-titres',
    'Regenerate captions': 'Régénérer les sous-titres',
    'Enter splits a line at the cursor · Backspace at the start of a line joins it to the line above · ✕ removes a line':
      'Entrée coupe une ligne au curseur · Retour arrière en début de ligne la fusionne avec celle du dessus · ✕ supprime une ligne',
    'Duplicate': 'Dupliquer',
    'Delete clip': 'Supprimer le clip',
    'Captions are turned off for all clips (Style tab).': 'Les sous-titres sont désactivés pour tous les clips (onglet Style).',
    'Speech recognition is not installed (see the Captions & AI tab).': 'La reconnaissance vocale n\'est pas installée (voir l\'onglet Sous-titres et IA).',
    'You changed the clip timing. Your caption edits are kept; only the added seconds will be transcribed when you render.':
      'Vous avez changé le minutage du clip. Vos corrections sont conservées ; seules les secondes ajoutées seront transcrites au rendu.',
    'You shortened the clip. Your caption edits are kept; lines outside the new timing are dropped when you render.':
      'Vous avez raccourci le clip. Vos corrections sont conservées ; les lignes hors du nouveau minutage seront retirées au rendu.',
    'No captions yet. They will be generated automatically when you render, or generate them now to review the words.':
      'Pas encore de sous-titres. Ils seront générés automatiquement au rendu, ou générez-les maintenant pour relire les mots.',
    'Put the cursor between two words to split the line': 'Placez le curseur entre deux mots pour couper la ligne',

    // ---- layout tab ----
    'Facecam on top': 'Facecam en haut',
    'Gameplay = full frame': 'Jeu = image entière',
    'Drag the boxes over your video to choose what goes into the short. Drag inside a box to move it, and drag a corner to resize it. With the keyboard: click the picture, press Enter to pick a box, use the arrow keys to move it and Shift + arrows to resize. The 9:16 preview on the right updates live.':
      'Faites glisser les cadres sur votre vidéo pour choisir ce qui va dans le short. Glissez à l\'intérieur d\'un cadre pour le déplacer, et un coin pour le redimensionner. Au clavier : cliquez sur l\'image, Entrée pour choisir un cadre, les flèches pour le déplacer et Maj + flèches pour le redimensionner. L\'aperçu 9:16 à droite se met à jour en direct.',
    'Facecam box selected': 'Cadre facecam sélectionné',
    'Gameplay box selected': 'Cadre jeu sélectionné',

    // ---- style tab ----
    'Preset': 'Préréglage',
    'Apply to project': 'Appliquer au projet',
    'Save current style as preset…': 'Enregistrer ce style comme préréglage…',
    'Delete preset': 'Supprimer le préréglage',
    'Choose a preset…': 'Choisir un préréglage…',
    'Title': 'Titre',
    'Font': 'Police',
    'Size': 'Taille',
    'Line 1': 'Ligne 1',
    'Line 2': 'Ligne 2',
    'Keep the title below the apps\' top bar': 'Garder le titre sous la barre du haut des applis',
    'Captions': 'Sous-titres',
    'Captions on (all clips)': 'Sous-titres activés (tous les clips)',
    'Text': 'Texte',
    'Current word': 'Mot en cours',
    'Animation': 'Animation',
    'Highlight word by word': 'Surligner mot par mot',
    'Static lines': 'Lignes fixes',
    'Words per line': 'Mots par ligne',
    'UPPERCASE': 'MAJUSCULES',
    'Auto position (between facecam and gameplay)': 'Position auto (entre la facecam et le jeu)',
    'Position': 'Position',
    'Look & export': 'Rendu visuel et export',
    'Background': 'Arrière-plan',
    'Blurred video': 'Vidéo floutée',
    'Solid dark': 'Fond sombre uni',
    'Accent (border, progress bar)': 'Couleur d\'accent (bordure, barre de progression)',
    'Facecam border': 'Bordure de la facecam',
    'Brighten facecam': 'Éclaircir la facecam',
    'Progress bar': 'Barre de progression',
    'Normalize loudness (−14 LUFS)': 'Normaliser le volume (−14 LUFS)',
    'Frame rate': 'Images par seconde',
    '30 fps': '30 im/s',
    '60 fps': '60 im/s',
    'Quality': 'Qualité',
    '(lower = better, bigger file)': '(plus bas = meilleur, fichier plus lourd)',

    // ---- captions & AI tab ----
    'Speech recognition isn\'t installed. Put': 'La reconnaissance vocale n\'est pas installée. Mettez',
    'and a model (': 'et un modèle (',
    ') in': ') dans',
    'Speech recognition (runs on this PC)': 'Reconnaissance vocale (sur ce PC)',
    'Model': 'Modèle',
    '(no model found)': '(aucun modèle trouvé)',
    'Spoken language': 'Langue parlée',
    'Detect automatically': 'Détection automatique',
    'English': 'Anglais', 'French': 'Français', 'Arabic': 'Arabe', 'Spanish': 'Espagnol', 'German': 'Allemand',
    'Italian': 'Italien', 'Portuguese': 'Portugais', 'Dutch': 'Néerlandais', 'Turkish': 'Turc', 'Russian': 'Russe',
    'Translate captions to English': 'Traduire les sous-titres en anglais',
    'Words to expect': 'Mots attendus',
    '(names and jargon, helps the AI spell them)': '(noms et jargon, pour que l\'IA les écrive bien)',
    'Captions are generated automatically when a clip is rendered. You can also generate them first from': 'Les sous-titres sont générés automatiquement au rendu d\'un clip. Vous pouvez aussi les générer avant depuis',
    'to fix any words. These words and the word fixes belong to this video only, so another video\'s topic never leaks in. Changing them only affects captions generated from now on.':
      'pour corriger des mots. Ces mots et les corrections appartiennent à cette vidéo uniquement : le sujet d\'une autre vidéo ne s\'y mêle jamais. Les modifier ne change que les sous-titres générés ensuite.',
    'to fix any words. These words and the word fixes belong to this video only, so another video\'s topic never leaks in. Changing them only affects captions generated from now on. If the AI ever writes this list into the captions during a silence, it is removed automatically.':
      'pour corriger des mots. Ces mots et les corrections appartiennent à cette vidéo uniquement : le sujet d\'une autre vidéo ne s\'y mêle jamais. Les modifier ne change que les sous-titres générés ensuite. Si l\'IA recopie cette liste dans les sous-titres pendant un silence, elle est retirée automatiquement.',
    'Word fixes (this video)': 'Corrections de mots (cette vidéo)',
    'Words the AI keeps getting wrong. Fixes are applied to every new caption automatically. Phrases work too, e.g.':
      'Les mots que l\'IA écrit souvent mal. Les corrections s\'appliquent automatiquement à chaque nouveau sous-titre. Les expressions marchent aussi, ex.',
    'Add': 'Ajouter',
    'Apply to all existing captions': 'Appliquer à tous les sous-titres existants',
    'No fixes yet.': 'Aucune correction pour l\'instant.',
    'Whole-stream transcript': 'Transcription du stream entier',
    'Optional. This transcribes the whole video once, so captions for every clip appear instantly and you can search what was said. It takes a while on long streams.':
      'Facultatif. Transcrit toute la vidéo une fois : les sous-titres de chaque clip apparaissent instantanément et vous pouvez chercher ce qui a été dit. C\'est long sur les longs streams.',
    'Transcribe whole stream': 'Transcrire tout le stream',
    'Re-transcribe whole stream': 'Retranscrire tout le stream',
    'No matches': 'Aucun résultat',

    // ---- exports, preview ----
    'Open output folder': 'Ouvrir le dossier output',
    'Up to date': 'À jour',
    'No clip': 'Sans clip',
    'Nothing rendered yet. Use': 'Rien n\'est encore rendu. Utilisez',
    'at the top.': 'en haut.',
    '9:16 preview': 'Aperçu 9:16',
    'live': 'en direct',
    'Render this clip': 'Rendu de ce clip',
    '⚡ Quick draft (10 s)': '⚡ Brouillon rapide (10 s)',
    'The preview is drawn from a low-resolution proxy. The rendered short uses the full-quality source.':
      'L\'aperçu utilise une copie basse résolution. Le short final utilise la source en pleine qualité.',
    'Show what TikTok / Shorts / Reels cover': 'Montrer ce que TikTok / Shorts / Reels masquent',
    'The title is under the apps\' top bar.': 'Le titre est sous la barre du haut des applis.',
    'Move the title down': 'Descendre le titre',
    'Captions are under the description at the bottom.': 'Les sous-titres sont sous la description en bas.',
    'Move captions up': 'Monter les sous-titres',
    'Captions are under the apps\' top bar.': 'Les sous-titres sont sous la barre du haut des applis.',
    'Move captions down': 'Descendre les sous-titres',
    'Show the covered areas': 'Montrer les zones masquées',
    'Title moved below the top bar': 'Titre descendu sous la barre du haut',
    'Captions moved into the visible area': 'Sous-titres déplacés dans la zone visible',
    'App top bar': 'Barre du haut de l\'appli',
    'Description, music, buttons': 'Description, musique, boutons',
    'Like / comment / share': 'J\'aime / commenter / partager',
    'CAPTIONS APPEAR HERE': 'LES SOUS-TITRES ICI',
    'Playhead is outside this clip': 'La tête de lecture est hors du clip',

    // ---- tasks ----
    'Clear finished': 'Effacer les terminées',
    'Cancel all': 'Tout annuler',
    'No tasks yet.': 'Aucune tâche pour l\'instant.',
    'queued': 'en attente',
    '✓ done': '✓ terminé',
    'failed': 'échec',
    'cancelled': 'annulé',
    'Cancel': 'Annuler',
    '↻ Retry': '↻ Réessayer',
    'Technical details': 'Détails techniques',
    'Copy': 'Copier',
    '(open now)': '(ouverte)',
    'Open': 'Ouvrir',
    'Waiting…': 'En attente…',
    'Finished': 'Terminé',
    'Measuring audio loudness': 'Mesure du volume audio',
    'Building fast preview + scanning action': 'Création de l\'aperçu rapide + analyse de l\'action',
    'Extracting audio': 'Extraction du son',
    'Transcribing speech (AI)': 'Transcription de la parole (IA)',
    'Transcribing the added seconds': 'Transcription des secondes ajoutées',
    'Updating captions for the new timing': 'Mise à jour des sous-titres pour le nouveau minutage',
    'Generating captions': 'Génération des sous-titres',
    'Rendering quick draft': 'Rendu du brouillon rapide',
    'Rendering video': 'Rendu de la vidéo',
    'Transcribe full stream': 'Transcrire tout le stream',
    'No captions yet: generate them in Edit clip to see them in drafts.': 'Pas encore de sous-titres : générez-les dans Modifier le clip pour les voir dans les brouillons.',
    // friendly error hints (server)
    'Cancelled.': 'Annulé.',
    'The disk is full. Free some space, then retry.': 'Le disque est plein. Libérez de la place, puis réessayez.',
    'A file is locked, probably open in a video player or in Explorer\'s preview. Close it, then retry.': 'Un fichier est verrouillé, sûrement ouvert dans un lecteur vidéo ou l\'aperçu de l\'Explorateur. Fermez-le, puis réessayez.',
    'Speech recognition is not installed correctly. See the Captions & AI tab.': 'La reconnaissance vocale n\'est pas bien installée. Voir l\'onglet Sous-titres et IA.',
    'This clip was deleted before the task ran.': 'Ce clip a été supprimé avant que la tâche ne démarre.',
    'The clip is shorter than 1 second. Make it longer.': 'Le clip dure moins d\'une seconde. Allongez-le.',
    'A file is missing. Check that the video is still in the source folder.': 'Un fichier manque. Vérifiez que la vidéo est toujours dans le dossier source.',
    'The video file looks damaged, or it is still being copied.': 'Le fichier vidéo semble abîmé, ou il est encore en cours de copie.',
    'A tool in the tools folder could not start. It may be missing or blocked by antivirus.': 'Un outil du dossier tools n\'a pas pu démarrer. Il manque peut-être, ou l\'antivirus le bloque.',
    'This video\'s project was removed. Open the video again.': 'Le projet de cette vidéo a été supprimé. Rouvrez la vidéo.',
    'Something went wrong. See the details below.': 'Un problème est survenu. Voir les détails ci-dessous.',
    // server errors
    'This project was changed in another tab or window.': 'Ce projet a été modifié dans un autre onglet ou une autre fenêtre.',
    'Video not found in source folder': 'Vidéo introuvable dans le dossier source',
    'Analyze the video first': 'Analysez d\'abord la vidéo',
    'Clip not found': 'Clip introuvable',
    'Give the preset a name': 'Donnez un nom au préréglage',
    'That name is used by a built-in preset': 'Ce nom est déjà pris par un préréglage intégré',
    'Unsupported file type': 'Type de fichier non pris en charge',
    'A video with this name already exists': 'Une vidéo avec ce nom existe déjà',
    'File not found': 'Fichier introuvable',

    // ---- help ----
    'Keyboard shortcuts': 'Raccourcis clavier',
    'Space': 'Espace',
    'Play / pause': 'Lecture / pause',
    'Seek 1 s (hold': 'Avancer / reculer de 1 s (maintenir',
    'Shift': 'Maj',
    'for 5 s)': 'pour 5 s)',
    'Set the clip start / end at the playhead': 'Placer le début / la fin du clip à la tête de lecture',
    'Play the selected clip': 'Lire le clip sélectionné',
    'Select the previous / next clip': 'Sélectionner le clip précédent / suivant',
    'Quick draft of the selected clip': 'Brouillon rapide du clip sélectionné',
    'Move the selected clip 1 s earlier / later (': 'Déplacer le clip sélectionné de 1 s plus tôt / plus tard (',
    ': 5 s)': ' : 5 s)',
    'Zoom the timeline in / out': 'Zoomer / dézoomer la timeline',
    'Tab': 'Tab',
    'Move between controls;': 'Passer d\'un contrôle à l\'autre ;',
    'Enter': 'Entrée',
    'selects a focused clip': 'sélectionne le clip ciblé',
    'Undo (clips, titles, captions, layout, style)': 'Annuler (clips, titres, sous-titres, disposition, style)',
    'or': 'ou',
    'Redo': 'Rétablir',
    'Show this help': 'Afficher cette aide',
    'Esc': 'Échap',
    'Close popups and menus': 'Fermer les fenêtres et menus',
    'Timeline': 'Timeline',
    'Scroll': 'Molette',
    'Zoom': 'Zoom',
    '+scroll · drag the time ruler': '+molette · glisser la règle du temps',
    'Pan': 'Défiler',
    'Drag empty space': 'Glisser dans le vide',
    'Create a new clip': 'Créer un nouveau clip',
    'Drag a clip / its edges': 'Glisser un clip / ses bords',
    'Move it / trim it': 'Le déplacer / le couper',
    'Double-click': 'Double-clic',
    'Show the whole video': 'Afficher toute la vidéo',
    'Blue line under the waveform': 'Ligne bleue sous la forme d\'onde',
    'Speech (from captions or the transcript)': 'Parole (d\'après les sous-titres ou la transcription)',
    'while dragging an edge': 'en glissant un bord',
    'Don\'t snap to speech pauses': 'Ne pas caler sur les pauses de la parole',
    'Layout tab (click the picture first)': 'Onglet Disposition (cliquez d\'abord sur l\'image)',
    'Switch between the facecam and gameplay boxes': 'Passer du cadre facecam au cadre jeu',
    'Arrow keys': 'Flèches',
    'Move the box (': 'Déplacer le cadre (',
    ': fine steps)': ' : petits pas)',
    '+ arrow keys': '+ flèches',
    'Resize the box': 'Redimensionner le cadre',
    'Caption lines': 'Lignes de sous-titres',
    'Split the line at the cursor': 'Couper la ligne au curseur',
    'Backspace': 'Retour arrière',
    'at line start': 'en début de ligne',
    'Join with the line above': 'Fusionner avec la ligne du dessus',

    // ---- tooltips, labels, placeholders ----
    'Video from the source folder': 'Vidéo du dossier source',
    'Video': 'Vidéo',
    'Language': 'Langue',
    'Refresh list': 'Actualiser la liste',
    'Refresh the video list': 'Actualiser la liste des vidéos',
    'Copy a video into the source folder': 'Copier une vidéo dans le dossier source',
    'Nothing to undo': 'Rien à annuler',
    'Nothing to redo': 'Rien à rétablir',
    'Open tasks': 'Ouvrir les tâches',
    'Keyboard shortcuts (?)': 'Raccourcis clavier (?)',
    'Videos you are working on': 'Vidéos en cours',
    'New clip starting at the playhead': 'Nouveau clip à la tête de lecture',
    'Find the strongest moments automatically': 'Trouver automatiquement les meilleurs moments',
    'Play / pause (Space)': 'Lecture / pause (Espace)',
    'Play or pause': 'Lecture ou pause',
    'Play only the selected clip': 'Lire seulement le clip sélectionné',
    'Clip edges stick to pauses in speech, so clips don\'t start or end mid-word. Hold Alt while dragging to turn it off.':
      'Les bords des clips se calent sur les pauses de la parole, pour ne pas couper au milieu d\'un mot. Maintenez Alt en glissant pour le désactiver.',
    'Make the video smaller or bigger (more room for the editor below)': 'Réduire ou agrandir la vidéo (plus de place pour l\'éditeur en dessous)',
    'Clip settings': 'Réglages du clip',
    'edit': 'modifier', 'layout': 'disposition', 'style': 'style', 'captions': 'sous-titres', 'exports': 'exports',
    'e.g. 11 SECONDS LEFT': 'ex. 11 SECONDES RESTANTES',
    'e.g. ON THE CLOCK...': 'ex. SUR LE FIL...',
    'Set start to the playhead': 'Placer le début à la tête de lecture',
    'Set end to the playhead': 'Placer la fin à la tête de lecture',
    'Correct a word in the captions of every clip of this video': 'Corriger un mot dans les sous-titres de tous les clips de cette vidéo',
    'e.g. chess, checkmate, mate in two, en passant, castling, blunder': 'ex. échecs, échec et mat, mat en deux, en passant, roque, gaffe',
    'Heard as… (made)': 'Entendu… (made)',
    'Should be… (mate)': 'À corriger en… (mate)',
    'Search what was said…': 'Chercher ce qui a été dit…',
    'Fast 10-second low-quality render from the playhead': 'Rendu rapide de 10 s en basse qualité depuis la tête de lecture',
    'Close': 'Fermer',
    'Close tasks': 'Fermer les tâches',
    'Video player': 'Lecteur vidéo',
    'Close video': 'Fermer la vidéo',
    'Remove from this bar (its project is kept)': 'Retirer de cette barre (le projet est conservé)',
    'Open another video': 'Ouvrir une autre vidéo',
    '＋ Video': '＋ Vidéo',
    'Stop this task': 'Arrêter cette tâche',
    'Include in batch render': 'Inclure dans le rendu groupé',
    'Remove this line': 'Supprimer cette ligne',
    'Remove this fix': 'Retirer cette correction',
    'Jump here': 'Aller ici',
    'Move to the Recycle Bin': 'Mettre à la corbeille',
    'Shorts must be 60 s or less': 'Un Short doit durer 60 s maximum',
    'This clip has its own layout or style': 'Ce clip a sa propre disposition ou son propre style',
    'You changed this clip after it was rendered. Render it again to update the video.': 'Vous avez modifié ce clip après son rendu. Relancez le rendu pour mettre la vidéo à jour.',
    'The render was cancelled. Retry it from Tasks or click Render.': 'Le rendu a été annulé. Relancez-le depuis Tâches ou avec Rendu.',
    'Timeline. Left and right arrows seek, I and O set the clip start and end, comma and period move the selected clip, plus and minus zoom.':
      'Timeline. Flèches gauche et droite pour se déplacer, I et O pour le début et la fin du clip, virgule et point pour déplacer le clip, plus et moins pour zoomer.',
    'Layout editor. Enter switches between the facecam and gameplay boxes. Arrow keys move the box, Shift plus arrow keys resize it, hold Alt for fine steps.':
      'Éditeur de disposition. Entrée passe du cadre facecam au cadre jeu. Les flèches déplacent le cadre, Maj + flèches le redimensionnent, Alt pour des petits pas.',

    // ---- pills ----
    'Rendered': 'Rendu', 'Outdated': 'Obsolète', 'Failed': 'Échec', 'Cancelled': 'Annulé', 'Queued': 'En file',
    'Custom': 'Personnalisé', 'Too long': 'Trop long',

    // ---- detect popover ----
    'How many': 'Combien',
    'Seconds each': 'Secondes chacun',
    'Finds the loudest, most action-packed moments: reactions, hype and big plays.': 'Trouve les moments les plus forts et les plus animés : réactions, hype et grosses actions.',
    'Add new moments': 'Ajouter de nouveaux moments',
    'Replace all clips': 'Remplacer tous les clips',

    // ---- save state, banners, messages ----
    'Saved ✓': 'Enregistré ✓',
    'Unsaved…': 'Non enregistré…',
    'Saving…': 'Enregistrement…',
    'Not saved': 'Non enregistré',
    'Not saved (app stopped)': 'Non enregistré (app arrêtée)',
    'Save failed': 'Échec de l\'enregistrement',
    'This video was changed in another tab or window, so your latest edits here were not saved.': 'Cette vidéo a été modifiée dans un autre onglet ou une autre fenêtre : vos dernières modifications ici n\'ont pas été enregistrées.',
    'Load the other version': 'Charger l\'autre version',
    'Keep my version': 'Garder ma version',
    'OK': 'OK',
    'This video is also open in another tab or window. Edit it in one place at a time, otherwise changes can clash.': 'Cette vidéo est aussi ouverte dans un autre onglet ou une autre fenêtre. Modifiez-la à un seul endroit à la fois, sinon les changements peuvent se contredire.',
    'First choose which version to keep (message at the top), then switch videos.': 'Choisissez d\'abord la version à garder (message en haut), puis changez de vidéo.',
    'Opening video…': 'Ouverture de la vidéo…',
    'Tip: click "Analyze video" to find the best moments automatically.': 'Astuce : cliquez sur « Analyser la vidéo » pour trouver automatiquement les meilleurs moments.',
    'Playing the original file. Click "Analyze video" to build a fast, smooth preview.': 'Lecture du fichier original. Cliquez sur « Analyser la vidéo » pour créer un aperçu rapide et fluide.',
    'The browser can\'t play this file directly. Click "Analyze video" to build a preview. Rendering works either way.': 'Le navigateur ne peut pas lire ce fichier directement. Cliquez sur « Analyser la vidéo » pour créer un aperçu. Le rendu fonctionne dans tous les cas.',
    'Analyze the video first. Auto-detect uses the loudness and action scan.': 'Analysez d\'abord la vidéo. La détection auto utilise l\'analyse du volume et de l\'action.',
    'Replace all clips (including your edits) with new suggestions?': 'Remplacer tous les clips (y compris vos modifications) par de nouvelles suggestions ?',
    'Moments updated. Ctrl+Z undoes this.': 'Moments mis à jour. Ctrl+Z pour annuler.',
    'Drag at least 2 seconds to create a clip': 'Glissez sur au moins 2 secondes pour créer un clip',
    'Transcribe this clip again from scratch? Any words you corrected by hand in this clip will be replaced.': 'Retranscrire ce clip depuis zéro ? Les mots corrigés à la main dans ce clip seront remplacés.',
    '(Saved word fixes are applied again automatically.)': '(Les corrections de mots enregistrées sont réappliquées automatiquement.)',
    'Delete this clip? Already-rendered video files are kept.': 'Supprimer ce clip ? Les vidéos déjà rendues sont conservées.',
    'Already in the queue': 'Déjà dans la file',
    'Select a clip first': 'Sélectionnez d\'abord un clip',
    'select a clip first': 'sélectionnez d\'abord un clip',
    'tick clips in the list first': 'cochez d\'abord des clips dans la liste',
    'everything is up to date': 'tout est à jour',
    'Tip:': 'Astuce :',
    'Transcribe whole stream first': 'Transcrire d\'abord tout le stream',
    'Name for this preset (it will be available for every video):': 'Nom du préréglage (disponible pour toutes les vidéos) :',
    'Type both the wrong word and the correct one': 'Tapez le mot erroné et le mot correct',
    'Nothing to fix in the existing captions.': 'Rien à corriger dans les sous-titres existants.',
    'Which word or phrase is wrong in the captions? (e.g. made)': 'Quel mot ou quelle expression est faux dans les sous-titres ? (ex. made)',
    'Moved to the Recycle Bin': 'Mis à la corbeille',
    'The app has stopped: its black window was closed. Rendering is paused and edits can\'t be saved. Double-click start.bat to start it again. This page reconnects by itself and offers to resume your tasks.':
      'L\'app s\'est arrêtée : sa fenêtre noire a été fermée. Le rendu est en pause et les modifications ne peuvent pas être enregistrées. Double-cliquez sur start.bat pour la relancer. Cette page se reconnecte toute seule et propose de reprendre vos tâches.',
    'Reconnected to the app': 'Reconnecté à l\'app',
    'Open video': 'Ouvrir la vidéo',
    'Watch': 'Regarder',
    'Details': 'Détails',
    'Resume': 'Reprendre',
    'Dismiss': 'Ignorer',
    'Error copied': 'Erreur copiée',
    'Could not copy. Select the text instead.': 'Copie impossible. Sélectionnez plutôt le texte.',
    'That task is already queued': 'Cette tâche est déjà dans la file',
    'Choose a video first': 'Choisissez d\'abord une vidéo',
    'Analyze again? Your clips are kept.': 'Analyser à nouveau ? Vos clips sont conservés.',
    'Analyzing. This takes a few minutes for long streams.': 'Analyse en cours. Quelques minutes pour les longs streams.',
    'Import failed': 'Échec de l\'import',
    'Cannot reach the local server. Is start.bat running?': 'Impossible de joindre le serveur local. start.bat est-il lancé ?',
    'Generating captions on this PC…': 'Génération des sous-titres sur ce PC…',
    'Transcribing the whole stream. This can take a while.': 'Transcription de tout le stream. Cela peut prendre du temps.',
    'The progress of this task will be lost.': 'La progression de cette tâche sera perdue.',
    'Tip: "New & outdated only" skips those.': 'Astuce : « Nouveaux et obsolètes seulement » les ignore.',
    'not analyzed': 'non analysée',
    'analyzed, no clips': 'analysée, aucun clip',
    'Request failed': 'Échec de la requête',
    // medium-priority additions
    'Copy a video into the source folder. For big files it is faster to copy the file into the source folder yourself, then click ⟳. You can also drop a video on this window.':
      'Copier une vidéo dans le dossier source. Pour les gros fichiers, c\'est plus rapide de copier vous-même le fichier dans le dossier source, puis de cliquer sur ⟳. Vous pouvez aussi déposer une vidéo sur cette fenêtre.',
    'Tip: for big recordings, copy the file straight into the': 'Astuce : pour les gros enregistrements, copiez le fichier directement dans le dossier',
    'folder (instant), then click ⟳. You can also drop a video anywhere on this window.': '(instantané), puis cliquez sur ⟳. Vous pouvez aussi déposer une vidéo n\'importe où sur cette fenêtre.',
    'Drop the video to add it to the source folder': 'Déposez la vidéo pour l\'ajouter au dossier source',
    'Only video files can be imported': 'Seuls les fichiers vidéo peuvent être importés',
    'With ticked clips': 'Avec les clips cochés',
    'With the': 'Avec les',
    'ticked clips…': 'clips cochés…',
    'With the ticked clip…': 'Avec le clip coché…',
    'Actions': 'Actions',
    'Trim to 60 s': 'Couper à 60 s',
    'Turn captions on': 'Activer les sous-titres',
    'Turn captions off': 'Désactiver les sous-titres',
    'Untick all': 'Tout décocher',
    'Delete': 'Supprimer',
    'Ctrl+Z undoes this.': 'Ctrl+Z pour annuler.',
    'Shorts can be 60 s at most': 'Un Short dure 60 s maximum',
    'Trimmed to': 'Coupé à',
    'OK = trim to 60 s, then render · Cancel = render as they are': 'OK = couper à 60 s puis lancer le rendu · Annuler = rendu tel quel',
    'Upload description (optional)': 'Description pour la publication (facultatif)',
    'Leave empty to use a quote from the captions': 'Laisser vide pour utiliser une citation des sous-titres',
    '✓ Layout looks right': '✓ La disposition est bonne',
    'Layout marked as checked': 'Disposition marquée comme vérifiée',
    'Encoder': 'Encodeur',
    'Best quality (processor)': 'Meilleure qualité (processeur)',
    'Faster (graphics card)': 'Plus rapide (carte graphique)',
    'Graphics card': 'Carte graphique',
    'A little faster and smaller files, with slightly lower quality. If it fails, the processor is used automatically.': 'Un peu plus rapide et fichiers plus légers, qualité légèrement inférieure. En cas d\'échec, le processeur prend le relais automatiquement.',
    'No compatible graphics encoder was found on this PC.': 'Aucun encodeur de carte graphique compatible n\'a été trouvé sur ce PC.',
    'Graphics encoder failed, using the processor': 'Échec de l\'encodeur graphique, utilisation du processeur',
    'Hashtags for uploads': 'Hashtags pour la publication',
    'Rewrite the .txt file next to each short': 'Réécrire le fichier .txt à côté de chaque short',
    'Update upload texts (.txt)': 'Mettre à jour les textes de publication (.txt)',
    'A .txt file with the title, description and hashtags is saved next to each short.': 'Un fichier .txt avec le titre, la description et les hashtags est enregistré à côté de chaque short.',
    'Copy title': 'Copier le titre',
    'Copy description': 'Copier la description',
    'Title copied': 'Titre copié',
    'Description copied': 'Description copiée',
    'Getting started with this video': 'Pour bien démarrer avec cette vidéo',
    'Hide': 'Masquer',
    'Analyze the video to find the best moments': 'Analyser la vidéo pour trouver les meilleurs moments',
    'Check the layout: place the facecam and gameplay boxes': 'Vérifier la disposition : placer les cadres facecam et jeu',
    'Open Layout': 'Ouvrir Disposition',
    'Give every clip a title': 'Donner un titre à chaque clip',
    'Next untitled': 'Suivant sans titre',
    'Render your first short': 'Faire le rendu de votre premier short',
    'Make a 30 s clip starting just before this': 'Créer un clip de 30 s qui commence juste avant',
    '＋ Clip': '＋ Clip',
    'Search clips (title or #number)…': 'Chercher un clip (titre ou n°)…',
    'Search clips': 'Chercher des clips',
    'Show': 'Afficher',
    'Sort': 'Trier',
    'Not rendered': 'Non rendus',
    'Untitled': 'Sans titre',
    'Over 60 s': 'Plus de 60 s',
    'By time': 'Par moment',
    'By strength': 'Par force',
    'By number': 'Par numéro',
    'No clips match.': 'Aucun clip ne correspond.',
    'Show all clips': 'Afficher tous les clips',
    'Video options': 'Options de la vidéo',
    'Open this video\'s project folder': 'Ouvrir le dossier projet de cette vidéo',
    'edits, analysis, preview, caption cache': 'modifications, analyse, aperçu, cache des sous-titres',
    'Open its output folder': 'Ouvrir son dossier output',
    'finished shorts and upload texts': 'shorts finis et textes de publication',
    'Start this video over…': 'Recommencer cette vidéo…',
    'its clips and edits go to the Recycle Bin; finished shorts are kept': 'ses clips et modifications vont à la corbeille ; les shorts finis sont conservés',
    'Its clips, titles, captions, word fixes and analysis go to the Recycle Bin. Finished shorts in the output folder are kept.': 'Ses clips, titres, sous-titres, corrections de mots et analyse vont à la corbeille. Les shorts finis du dossier output sont conservés.',
    'This video starts fresh. The old project is in the Recycle Bin.': 'Cette vidéo repart de zéro. L\'ancien projet est dans la corbeille.',
    '💡 Title ideas': '💡 Idées de titres',
    'Title ideas from what was said in this clip': 'Idées de titres tirées de ce qui est dit dans ce clip',
    'Generate captions first: ideas come from what was said in the clip.': 'Générez d\'abord les sous-titres : les idées viennent de ce qui est dit dans le clip.',
    'No good phrase found in this clip. Try writing your own.': 'Aucune phrase marquante trouvée dans ce clip. Essayez d\'écrire le vôtre.',
    'Use this title': 'Utiliser ce titre',
    'Title set. Edit it freely; Ctrl+Z undoes this.': 'Titre appliqué. Modifiez-le librement ; Ctrl+Z pour annuler.',
    'OK = render anyway · Cancel = add titles first (💡 Title ideas can help)': 'OK = lancer le rendu quand même · Annuler = ajouter d\'abord des titres (💡 Idées de titres peut aider)',
    'Delete the ticked clip? Already-rendered video files are kept.': 'Supprimer le clip coché ? Les vidéos déjà rendues sont conservées.',
  };

  // Labels used in undo/redo messages.
  const CHANGE = {
    'add clip': 'ajout de clip', 'delete clip': 'suppression de clip', 'clip changes': 'modifications de clips', 'clip ticks': 'cases cochées',
    'layout': 'disposition', 'style': 'style', 'caption settings': 'réglages des sous-titres', 'edit': 'modification',
    'auto-detect': 'détection auto', 'auto-detect (replace)': 'détection auto (remplacement)', 'word fixes': 'corrections de mots',
  };
  const change = l => CHANGE[l] || l
    .replace(/^delete clip (#\S+)$/, 'suppression du clip $1').replace(/^timing of (#\S+)$/, 'minutage de $1')
    .replace(/^title of (#\S+)$/, 'titre de $1').replace(/^captions of (#\S+)$/, 'sous-titres de $1').replace(/^settings of (#\S+)$/, 'réglages de $1');
  const KIND = { Rendering: 'Rendu', 'Quick draft': 'Brouillon rapide', Captions: 'Sous-titres', Analyzing: 'Analyse', Transcribing: 'Transcription', Working: 'Travail', Waiting: 'En attente' };
  const KIND_LC = { rendering: 'rendu', draft: 'brouillon', captions: 'sous-titres', analyzing: 'analyse', transcribing: 'transcription', working: 'en cours' };
  const left = r => r.replace(' · less than a minute left', ' · moins d\'une minute restante').replace(/ · about (.+) left$/, ' · environ $1 restantes');
  const counts = r => r.replace(/(\d+) done/, '$1 terminée(s)').replace(/(\d+) failed/, '$1 en échec').replace(/(\d+) cancelled/, '$1 annulée(s)');

  // Messages built from numbers and names. Each entry: [pattern, replacement or function].
  const PATTERNS = [
    [/^(\d+)\/(\d+) rendered(?: · (\d+) outdated)?(?: · (\d+) ticked)?$/, (m, a, b, o, t) => `${a}/${b} rendus${o ? ` · ${o} obsolète(s)` : ''}${t ? ` · ${t} coché(s)` : ''}`],
    [/^(\d+) ticked in the clip list$/, '$1 coché(s) dans la liste'],
    [/^(\d+) not rendered or changed since$/, '$1 non rendu(s) ou modifié(s) depuis'],
    [/^(\d+) clips$/, '$1 clips'],
    [/^(Rendering|Draft|Captions|Working) (\d+)%$/, (m, k, p) => `${{ Rendering: 'Rendu', Draft: 'Brouillon', Captions: 'Sous-titres', Working: 'En cours' }[k]} ${p} %`],
    [/^Overlaps (.+)$/, 'Chevauche $1'],
    [/^#(\d+) Untitled clip$/, '#$1 Clip sans titre'],
    [/^Give every clip a title \((\d+) untitled\)$/, 'Donner un titre à chaque clip ($1 sans titre)'],
    [/^(\d+) clips? (?:is|are) longer than 60 s, the Shorts limit\.$/, '$1 clip(s) dépasse(nt) 60 s, la limite des Shorts.'],
    [/^Trimmed (\d+) clips? to 60 s$/, '$1 clip(s) coupé(s) à 60 s'],
    [/^Delete (\d+) ticked clips\? Already-rendered video files are kept\.$/, 'Supprimer les $1 clips cochés ? Les vidéos déjà rendues sont conservées.'],
    [/^(\d+) clips? updated\. (.+)$/, (m, n, r) => `${n} clip(s) modifié(s). ${t(r)}`],
    [/^(\d+) clips? deleted\. (.+)$/, (m, n, r) => `${n} clip(s) supprimé(s). ${t(r)}`],
    [/^(\d+) upload texts? updated$/, '$1 texte(s) de publication mis à jour'],
    [/^Trimmed to ([\d.]+) s$/, 'Coupé à $1 s'],
    [/^(\d+) of these clips have no title\.$/, '$1 de ces clips n\'ont pas de titre.'],
    [/^#(\d+) has no title\.$/, 'Le clip #$1 n\'a pas de titre.'],
    [/^Start "(.+)" over\?$/, 'Recommencer « $1 » ?'],
    [/^Clip #(\d+) (.*), (\S+), (\d+) seconds$/, (m, n, ti, at, d) => `Clip #${n} ${ti === 'Untitled' ? 'sans titre' : ti}, ${at}, ${d} secondes`],
    [/^Shares footage with clip (.+)$/, 'Partage des images avec le clip $1'],
    [/^(.+) \(details in Tasks\)$/, (m, h) => `${t(h)} (détails dans Tâches)`],
    [/^Moment strength (\d+)\/100$/, 'Force du moment $1/100'],
    [/^(Rendering|Quick draft|Captions|Analyzing|Transcribing|Working|Waiting) (\d+)\/(\d+)(.*)$/, (m, k, a, b, rest) => `${KIND[k]} ${a}/${b}${left(rest)}`],
    [/^(\d+ done.*) · runs on this PC, keep the black window open$/, (m, r) => `${counts(r)} · tourne sur ce PC, gardez la fenêtre noire ouverte`],
    [/^(rendering|draft|captions|analyzing|transcribing|working) (\d+)%(?: · (\d+) tasks)?$/, (m, k, p, n) => `${KIND_LC[k]} ${p} %${n ? ` · ${n} tâches` : ''}`],
    [/^Render (#.*)$/, 'Rendu $1'],
    [/^Quick draft (#.*)$/, 'Brouillon rapide $1'],
    [/^Analyze (.+\.(?:mkv|mp4|mov|webm|flv|avi|ts|m4v))$/i, 'Analyse de $1'],
    [/^(.+?): done$/, (m, l) => `${t(l)} : terminé`],
    [/^(.+?) failed\. ?(.*)$/, (m, l, h) => `${t(l)} : échec. ${t(h)}`],
    [/^(.+?) is ready\.$/, (m, l) => `${t(l)} est prêt.`],
    [/^(.+) · low-quality preview(, not saved to output)?$/, (m, l, n) => `${t(l)} · aperçu basse qualité${n ? ', non enregistré dans output' : ''}`],
    [/^(\d+) clips? added to the render queue$/, '$1 clip(s) ajouté(s) à la file de rendu'],
    [/^(\d+) tasks? added back to the queue$/, '$1 tâche(s) remise(s) dans la file'],
    [/^All tasks finished: (.*)$/, (m, r) => `Toutes les tâches sont terminées : ${counts(r)}`],
    [/^(\d+) tasks? (?:were|was) stopped when the app was closed: (.+)\.$/, (m, n, l) => `${n} tâche(s) arrêtée(s) à la fermeture de l'app : ${l.split(', ').map(x => t(x)).join(', ')}.`],
    [/^↻ Retry (\d+) cancelled$/, '↻ Réessayer les $1 annulées'],
    [/^↻ Retry (\d+) failed$/, '↻ Réessayer les $1 en échec'],
    [/^Cancel "(.+)"\?$/, (m, l) => `Annuler « ${t(l)} » ?`],
    [/^Cancel all (\d+) tasks\? You can retry them afterwards\.$/, 'Annuler les $1 tâches ? Vous pourrez les relancer ensuite.'],
    [/^Render all (\d+) clips\? (\d+) of them are already up to date and will be rendered again\.$/, 'Faire le rendu des $1 clips ? $2 sont déjà à jour et seront refaits.'],
    [/^Delete the preset "(.+)"\? Clips already using it keep their look\.$/, 'Supprimer le préréglage « $1 » ? Les clips qui l\'utilisent gardent leur apparence.'],
    [/^Move "(.+)" to the Recycle Bin\?$/, 'Mettre « $1 » à la corbeille ?'],
    [/^Replace "(.+)" with:$/, 'Remplacer « $1 » par :'],
    [/^Preset "(.+)" applied to the project$/, 'Préréglage « $1 » appliqué au projet'],
    [/^Preset "(.+)" saved$/, 'Préréglage « $1 » enregistré'],
    [/^Fixed (\d+) places? in your captions\. Render again to update finished videos\.$/, '$1 correction(s) faite(s) dans vos sous-titres. Relancez le rendu pour mettre à jour les vidéos finies.'],
    [/^Importing (.+)… (\d+)%$/, 'Import de $1… $2 %'],
    [/^Clip #(\d+) created \(([\d.]+) s\)\. Give it a title\.$/, 'Clip #$1 créé ($2 s). Donnez-lui un titre.'],
    [/^Quick draft of #(\d+) from (\S+)… it opens when ready$/, 'Brouillon rapide de #$1 depuis $2… il s\'ouvre quand il est prêt'],
    [/^#(\d+) (start|end) set to (\S+) · now ([\d.]+) s(?: \((.+)\))?$/, (m, n, w, a, d, how) => `#${n} : ${w === 'start' ? 'début' : 'fin'} à ${a} · durée ${d} s${how ? ` (${t(how)})` : ''}`],
    [/^(Start|End) unchanged \(a clip must be at least 2 s\)$/, (m, w) => `${w === 'Start' ? 'Début' : 'Fin'} inchangé(e) (un clip dure au moins 2 s)`],
    [/^#(\d+) moved to (\S+) → (\S+)$/, '#$1 déplacé : $2 → $3'],
    [/^(Undone|Redone): (.+)$/, (m, v, l) => `${v === 'Undone' ? 'Annulé' : 'Rétabli'} : ${change(l)}`],
    [/^Nothing to (undo|redo)$/, (m, v) => v === 'undo' ? 'Rien à annuler' : 'Rien à rétablir'],
    [/^(Undo|Redo) (.+) \((Ctrl\+[ZY])\)$/, (m, v, l, k) => `${v === 'Undo' ? 'Annuler' : 'Rétablir'} : ${change(l)} (${k})`],
    [/^This title is long, so it's shrunk to (\d+) px \(style size (\d+) px\) to fit the width\. Shorter lines stay bigger\.$/, 'Ce titre est long : il est réduit à $1 px (taille du style $2 px) pour tenir en largeur. Des lignes plus courtes restent plus grandes.'],
    [/^(\d+) clips? (?:uses its|use their) own style \(Edit clip\), so changes here don't affect (?:it|them)\.$/, '$1 clip(s) utilise(nt) leur propre style (Modifier le clip) : les changements ici ne les touchent pas.'],
    [/^(\d+) caption lines\. Click any line to fix the words\.$/, '$1 lignes de sous-titres. Cliquez sur une ligne pour corriger les mots.'],
    [/^Listening… (\d+)%$/, 'Écoute… $1 %'],
    [/^([\d.]+)s: too long for Shorts \(max 60s\)$/, '$1 s : trop long pour un Short (60 s max)'],
    [/^Other videos in the output folder \((\d+)\)$/, 'Autres vidéos dans le dossier output ($1)'],
    [/^(\d+) clips still need captions\. Transcribing the whole stream once is faster than one clip at a time, and makes captions instant afterwards\.$/, '$1 clips n\'ont pas encore de sous-titres. Transcrire tout le stream une fois est plus rapide que clip par clip, et les sous-titres deviennent instantanés ensuite.'],
    [/^Facecam: (.+) at (.+)$/, 'Facecam : $1 à $2'],
    [/^Gameplay: (.+) at (.+)$/, 'Jeu : $1 à $2'],
    [/^(.+) \(built-in\)$/, '$1 (intégré)'],
    [/^(.+) \(deleted preset\)$/, '$1 (préréglage supprimé)'],
    [/^took (.+)$/, 'durée $1'],
    [/^(.+) · ([\d.]+ [GM]B) · analyzed$/, '$1 · $2 · analysée'],
    [/^([\d.]+ [GM]B)(.*?)(?: · (\d+) clips · (\d+) rendered| · (analyzed|started|new))$/, (m, size, dur, c, r, st) => `${size}${dur}${c ? ` · ${c} clips · ${r} rendus` : ' · ' + { analyzed: 'analysée', started: 'commencée', new: 'nouvelle' }[st]}`],
    [/^Remove (.+) from this bar$/, 'Retirer $1 de cette barre'],
    [/^Delete (.+\.mp4)$/, 'Supprimer $1'],
    [/^Caption line (\d+)$/, 'Ligne de sous-titre $1'],
    [/^Remove line (\d+)$/, 'Supprimer la ligne $1'],
    [/^Request failed \((\d+)\)$/, 'Échec de la requête ($1)'],
    [/^Snapped to a (.+)$/, (m, h) => `Calé sur : ${t(h)}`],
  ];

  function core(s) {
    const k = s.replace(/\s+/g, ' ').trim();
    if (!k) return null;
    if (Object.prototype.hasOwnProperty.call(FR, k)) return FR[k];
    for (const [re, rep] of PATTERNS) if (re.test(k)) return k.replace(re, rep);
    return null;
  }
  function t(s) {
    if (lang !== 'fr' || s == null) return s;
    s = String(s);
    let r = core(s);
    if (r == null && s.includes('\n')) { // multi-line messages (dialogs): translate line by line
      const lines = s.split('\n').map(l => core(l) ?? l);
      return lines.join('\n');
    }
    if (r == null) return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    return lead + r + trail;
  }
  window.tr = t;
  window.I18N = {
    lang,
    set(l) { try { localStorage.setItem(KEY, l); } catch { /* ignore */ } location.reload(); },
  };
  if (lang !== 'fr') return;

  // ---- translate the page as it is shown ----
  const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
  const SKIP = 'script, style, textarea, input, [translate="no"]';
  function doText(n) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const v = n.nodeValue, r = t(v);
    if (r !== v) n.nodeValue = r;
  }
  function doAttrs(el) {
    if (el.closest('[translate="no"]')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const r = t(v); if (r !== v) el.setAttribute(a, r); }
    }
  }
  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1) return;
    doAttrs(node);
    const tw = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  walk(document.body);
  document.title = t(document.title);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  // native dialogs
  const c0 = window.confirm.bind(window), p0 = window.prompt.bind(window), a0 = window.alert.bind(window);
  window.confirm = msg => c0(t(msg));
  window.prompt = (msg, def) => p0(t(msg), def);
  window.alert = msg => a0(t(msg));
})();

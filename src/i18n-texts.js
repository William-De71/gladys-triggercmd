// -----------------------------------------------------------------------------
// Runtime texts in English, French, German and Spanish. German says "du",
// Spanish "usted". Computer and command names come from TRIGGERcmd, never
// translated.
// -----------------------------------------------------------------------------

const TEXTS = {
  // --- Times --------------------------------------------------------------------------
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: {
    en: '{n} days ago',
    fr: 'il y a {n} jours',
    de: 'vor {n} Tagen',
    es: 'hace {n} días',
  },

  // --- Connection status -------------------------------------------------------------
  statusNoToken: {
    en: 'Enter the token of your TRIGGERcmd account in the configuration.',
    fr: 'Saisissez le jeton de votre compte TRIGGERcmd dans la configuration.',
    de: 'Gib das Token deines TRIGGERcmd-Kontos in der Konfiguration ein.',
    es: 'Introduzca el token de su cuenta TRIGGERcmd en la configuración.',
  },
  statusRefused: {
    en: 'TRIGGERcmd refuses the token: copy it again from triggercmd.com.',
    fr: 'TRIGGERcmd refuse le jeton : copiez-le à nouveau depuis triggercmd.com.',
    de: 'TRIGGERcmd lehnt das Token ab: kopiere es erneut von triggercmd.com.',
    es: 'TRIGGERcmd rechaza el token: cópielo de nuevo desde triggercmd.com.',
  },
  statusWaiting: {
    en: 'Reading the computers and their commands…',
    fr: 'Lecture des ordinateurs et de leurs commandes…',
    de: 'Computer und ihre Befehle werden gelesen…',
    es: 'Leyendo los ordenadores y sus comandos…',
  },
  statusOk: {
    en: 'Computers: {computers}, commands: {commands}.',
    fr: 'Ordinateurs : {computers}, commandes : {commands}.',
    de: 'Computer: {computers}, Befehle: {commands}.',
    es: 'Ordenadores: {computers}, comandos: {commands}.',
  },
  statusNoComputer: {
    en: 'Connected, but no computer has a command yet: install the TRIGGERcmd agent.',
    fr: 'Connecté, mais aucun ordinateur n’a encore de commande : installez l’agent TRIGGERcmd.',
    de: 'Verbunden, aber noch kein Computer hat einen Befehl: installiere den TRIGGERcmd-Agenten.',
    es: 'Conectado, pero ningún ordenador tiene aún comandos: instale el agente TRIGGERcmd.',
  },
  statusGladys_off: {
    en: 'Computer “{name}”: off.',
    fr: 'Ordinateur « {name} » : désactivé.',
    de: 'Computer „{name}“: aus.',
    es: 'Ordenador «{name}»: desactivado.',
  },
  statusGladys_waiting: {
    en: 'Computer “{name}”: setting up.',
    fr: 'Ordinateur « {name} » : mise en place.',
    de: 'Computer „{name}“: wird eingerichtet.',
    es: 'Ordenador «{name}»: configurándose.',
  },
  statusGladys_connecting: {
    en: 'Computer “{name}”: connecting.',
    fr: 'Ordinateur « {name} » : connexion.',
    de: 'Computer „{name}“: verbindet.',
    es: 'Ordenador «{name}»: conectando.',
  },
  statusGladys_listening: {
    en: 'Computer “{name}”: listening.',
    fr: 'Ordinateur « {name} » : à l’écoute.',
    de: 'Computer „{name}“: hört zu.',
    es: 'Ordenador «{name}»: a la escucha.',
  },
  statusGladys_subscription: {
    en: 'Computer “{name}”: your plan allows a single computer.',
    fr: 'Ordinateur « {name} » : votre offre n’autorise qu’un ordinateur.',
    de: 'Computer „{name}“: dein Tarif erlaubt nur einen Computer.',
    es: 'Ordenador «{name}»: su plan solo permite un ordenador.',
  },
  statusGladys_refused: {
    en: 'Computer “{name}”: token refused.',
    fr: 'Ordinateur « {name} » : jeton refusé.',
    de: 'Computer „{name}“: Token abgelehnt.',
    es: 'Ordenador «{name}»: token rechazado.',
  },
  statusGladys_failed: {
    en: 'Computer “{name}”: not connected, trying again.',
    fr: 'Ordinateur « {name} » : non connecté, nouvel essai prévu.',
    de: 'Computer „{name}“: nicht verbunden, neuer Versuch folgt.',
    es: 'Ordenador «{name}»: no conectado, se reintentará.',
  },

  // --- Errors ------------------------------------------------------------------------
  errAuth: {
    en: 'TRIGGERcmd refuses the token: copy it again from triggercmd.com.',
    fr: 'TRIGGERcmd refuse le jeton : copiez-le à nouveau depuis triggercmd.com.',
    de: 'TRIGGERcmd lehnt das Token ab: kopiere es erneut von triggercmd.com.',
    es: 'TRIGGERcmd rechaza el token: cópielo de nuevo desde triggercmd.com.',
  },
  errSubscribe: {
    en: 'TRIGGERcmd refuses: this needs a subscription (a second computer).',
    fr: 'TRIGGERcmd refuse : il faut un abonnement (second ordinateur).',
    de: 'TRIGGERcmd lehnt ab: dafür ist ein Abonnement nötig (zweiter Computer).',
    es: 'TRIGGERcmd lo rechaza: se necesita una suscripción (segundo ordenador).',
  },
  errNotFound: {
    en: 'TRIGGERcmd does not know this computer or this command.',
    fr: 'TRIGGERcmd ne connaît pas cet ordinateur ou cette commande.',
    de: 'TRIGGERcmd kennt diesen Computer oder diesen Befehl nicht.',
    es: 'TRIGGERcmd no conoce este ordenador o este comando.',
  },
  errRateLimit: {
    en: 'TRIGGERcmd asks to wait: try again in a minute.',
    fr: 'TRIGGERcmd demande d’attendre : réessayez dans une minute.',
    de: 'TRIGGERcmd bittet zu warten: versuche es in einer Minute erneut.',
    es: 'TRIGGERcmd pide esperar: inténtelo de nuevo en un minuto.',
  },
  errUnreachable: {
    en: 'TRIGGERcmd cannot be reached: check the internet access of Gladys.',
    fr: 'TRIGGERcmd est injoignable : vérifiez l’accès à Internet de Gladys.',
    de: 'TRIGGERcmd ist nicht erreichbar: prüfe den Internetzugang von Gladys.',
    es: 'No se puede acceder a TRIGGERcmd: compruebe el acceso a Internet de Gladys.',
  },
  errServer: {
    en: 'TRIGGERcmd has a problem: try again later.',
    fr: 'TRIGGERcmd rencontre un problème : réessayez plus tard.',
    de: 'TRIGGERcmd hat ein Problem: versuche es später erneut.',
    es: 'TRIGGERcmd tiene un problema: inténtelo más tarde.',
  },
  errUnknownCommand: {
    en: 'Unknown command “{command}” on the computer “{computer}”.',
    fr: 'Commande « {command} » inconnue sur l’ordinateur « {computer} ».',
    de: 'Unbekannter Befehl „{command}“ auf dem Computer „{computer}“.',
    es: 'Comando «{command}» desconocido en el ordenador «{computer}».',
  },
  errGladysComputer: {
    en: 'The Gladys computer starts scenes: it is not run from Gladys.',
    fr: 'L’ordinateur Gladys lance des scènes : il ne se pilote pas depuis Gladys.',
    de: 'Der Gladys-Computer startet Szenen: er wird nicht aus Gladys gesteuert.',
    es: 'El ordenador Gladys lanza escenas: no se controla desde Gladys.',
  },
  errCommandGone: {
    en: 'This command no longer exists: refresh the widget.',
    fr: 'Cette commande n’existe plus : actualisez le widget.',
    de: 'Dieser Befehl existiert nicht mehr: aktualisiere das Widget.',
    es: 'Este comando ya no existe: actualice el widget.',
  },
  errFailed: {
    en: 'Failed: {detail}',
    fr: 'Échec : {detail}',
    de: 'Fehlgeschlagen: {detail}',
    es: 'Error: {detail}',
  },

  // --- Results -----------------------------------------------------------------------
  runSent: {
    en: '“{command}” sent to {computer}.',
    fr: '« {command} » envoyée à {computer}.',
    de: '„{command}“ an {computer} gesendet.',
    es: '«{command}» enviado a {computer}.',
  },
  refreshDone: {
    en: 'Computers: {computers}, commands: {commands}.',
    fr: 'Ordinateurs : {computers}, commandes : {commands}.',
    de: 'Computer: {computers}, Befehle: {commands}.',
    es: 'Ordenadores: {computers}, comandos: {commands}.',
  },
  testOk: {
    en: 'Connected. Computers: {computers}{names}, commands: {commands}.',
    fr: 'Connecté. Ordinateurs : {computers}{names}, commandes : {commands}.',
    de: 'Verbunden. Computer: {computers}{names}, Befehle: {commands}.',
    es: 'Conectado. Ordenadores: {computers}{names}, comandos: {commands}.',
  },
  testNoComputer: {
    en: 'Connected, but no computer has a command yet: install the TRIGGERcmd agent on a computer.',
    fr: 'Connecté, mais aucun ordinateur n’a encore de commande : installez l’agent TRIGGERcmd sur un ordinateur.',
    de: 'Verbunden, aber noch kein Computer hat einen Befehl: installiere den TRIGGERcmd-Agenten auf einem Computer.',
    es: 'Conectado, pero ningún ordenador tiene aún comandos: instale el agente TRIGGERcmd en un ordenador.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration ({count} line(s) “TRIGGERcmd diagnostic”). No token in it.',
    fr: 'Diagnostic écrit dans les journaux de l’intégration ({count} ligne(s) « TRIGGERcmd diagnostic »). Sans le jeton.',
    de: 'Diagnose in die Protokolle der Integration geschrieben ({count} Zeile(n) „TRIGGERcmd diagnostic“). Ohne Token.',
    es: 'Diagnóstico escrito en los registros de la integración ({count} línea(s) «TRIGGERcmd diagnostic»). Sin el token.',
  },

  // --- Widget ------------------------------------------------------------------------
  tileComputer: { en: 'Computer', fr: 'Ordinateur', de: 'Computer', es: 'Ordenador' },
  tileComputers: { en: 'Computers', fr: 'Ordinateurs', de: 'Computer', es: 'Ordenadores' },
  tileCommands: { en: 'Commands', fr: 'Commandes', de: 'Befehle', es: 'Comandos' },
  rowGladysComputer: {
    en: 'Computer “{name}”',
    fr: 'Ordinateur « {name} »',
    de: 'Computer „{name}“',
    es: 'Ordenador «{name}»',
  },
  gladys_off: { en: 'Off', fr: 'Désactivé', de: 'Aus', es: 'Desactivado' },
  gladys_waiting: {
    en: 'Setting up',
    fr: 'Mise en place',
    de: 'Wird eingerichtet',
    es: 'Configurándose',
  },
  gladys_connecting: { en: 'Connecting', fr: 'Connexion', de: 'Verbindet', es: 'Conectando' },
  gladys_listening: {
    en: 'Listening',
    fr: 'À l’écoute',
    de: 'Hört zu',
    es: 'A la escucha',
  },
  gladys_subscription: {
    en: 'Subscription needed',
    fr: 'Abonnement requis',
    de: 'Abo erforderlich',
    es: 'Requiere suscripción',
  },
  gladys_refused: {
    en: 'Token refused',
    fr: 'Jeton refusé',
    de: 'Token abgelehnt',
    es: 'Token rechazado',
  },
  gladys_failed: {
    en: 'Not connected',
    fr: 'Non connecté',
    de: 'Nicht verbunden',
    es: 'No conectado',
  },
  badgeSent: { en: 'Sent', fr: 'Envoyée', de: 'Gesendet', es: 'Enviado' },
  badgeFailed: { en: 'Failed', fr: 'Échec', de: 'Fehler', es: 'Error' },
  badgeReceived: { en: 'Received', fr: 'Reçue', de: 'Empfangen', es: 'Recibido' },
  cardFrom: { en: 'from {sender}', fr: 'de {sender}', de: 'von {sender}', es: 'de {sender}' },
  cardAgo: {
    en: 'Run {ago}.',
    fr: 'Lancée {ago}.',
    de: 'Ausgeführt {ago}.',
    es: 'Ejecutado {ago}.',
  },
  widgetNoRun: {
    en: 'No command run yet: use the button below, a device or a scene.',
    fr: 'Aucune commande lancée pour l’instant : utilisez le bouton ci-dessous, un appareil ou une scène.',
    de: 'Noch kein Befehl ausgeführt: nutze die Schaltfläche unten, ein Gerät oder eine Szene.',
    es: 'Aún no se ha ejecutado ningún comando: use el botón de abajo, un dispositivo o una escena.',
  },
  widgetNoCommand: {
    en: 'No command yet: install the TRIGGERcmd agent on a computer and add commands to it.',
    fr: 'Aucune commande pour l’instant : installez l’agent TRIGGERcmd sur un ordinateur et ajoutez-y des commandes.',
    de: 'Noch kein Befehl: installiere den TRIGGERcmd-Agenten auf einem Computer und füge Befehle hinzu.',
    es: 'Aún no hay comandos: instale el agente TRIGGERcmd en un ordenador y añádale comandos.',
  },
  buttonRun: {
    en: 'Run a command',
    fr: 'Lancer une commande',
    de: 'Befehl ausführen',
    es: 'Ejecutar un comando',
  },
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  fieldCommand: { en: 'Command', fr: 'Commande', de: 'Befehl', es: 'Comando' },
  fieldParameters: { en: 'Parameters', fr: 'Paramètres', de: 'Parameter', es: 'Parámetros' },
  fieldParametersHelp: {
    en: 'Only for a command that allows parameters (“Allow Parameters” in the agent).',
    fr: 'Seulement pour une commande qui accepte des paramètres (« Allow Parameters » dans l’agent).',
    de: 'Nur für einen Befehl, der Parameter erlaubt („Allow Parameters“ im Agenten).',
    es: 'Solo para un comando que acepta parámetros («Allow Parameters» en el agente).',
  },
  fieldParametersPlaceholder: {
    en: 'Optional, e.g. on, off, 50',
    fr: 'Facultatif, ex. on, off, 50',
    de: 'Optional, z. B. on, off, 50',
    es: 'Opcional, p. ej. on, off, 50',
  },
};

export { TEXTS };

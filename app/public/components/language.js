'use strict';
// Language switch.

$('#langSelect').value = I18N.lang;
$('#langSelect').addEventListener('change', async e => { await saveNow(); rememberUi(); I18N.set(e.target.value); });

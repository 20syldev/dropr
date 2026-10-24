import { Router } from 'express';
import { MAX_TOKEN_LENGTH, MIN_TOKEN_LENGTH } from '../constants.js';
import { challengeStorage, chatStorage, ticTacToeStorage } from '../storage/index.js';
import { since } from '../utils/helpers.js';
import { error } from '../utils/response.js';
const router = Router();
// Asymmetric RSA key generation, encryption and decryption
router.post('/:version/asymmetric', (req, res) => {
    const body = req.body || {};
    const { action, text, publicKey, privateKey, modulusLength, algorithm } = body;
    const { version } = req.params;
    const asymmetricFn = req.module.asymmetric;
    if (!asymmetricFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!action) {
        error(res, 400, 'Please provide an action (?action=keygen|encrypt|decrypt)');
        return;
    }
    try {
        const result = asymmetricFn(action, {
            text: text,
            publicKey: publicKey,
            privateKey: privateKey,
            modulusLength: modulusLength !== undefined ? Number(modulusLength) : undefined,
            algorithm: algorithm,
        });
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Verify a captcha answer against its token
router.post('/:version/captcha', (req, res) => {
    const body = req.body || {};
    const { token, answer } = body;
    const { version } = req.params;
    const verifyFn = req.module.verifyCaptcha;
    if (!verifyFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!token || typeof token !== 'string') {
        error(res, 400, 'Please provide a token (?token={token})');
        return;
    }
    if (!answer || typeof answer !== 'string') {
        error(res, 400, 'Please provide an answer (&answer={answer})');
        return;
    }
    try {
        res.jsonResponse(verifyFn(token, answer, challengeStorage));
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Generate a chart as SVG
router.post('/:version/chart', (req, res) => {
    const body = req.body || {};
    const { type, data, title, width, height, colors, bg, legend, mode } = body;
    const { version } = req.params;
    const chartMod = req.module.chart;
    if (!chartMod) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!type || typeof type !== 'string' || !Object.hasOwn(chartMod, type)) {
        error(res, 400, 'Please provide a valid chart type (?type=bar|line|pie|donut)');
        return;
    }
    try {
        const output = chartMod[type](data, { title, width, height, colors, bg, legend, mode });
        if (output.contentType === 'application/json') {
            res.jsonResponse(output.body);
        }
        else {
            res.type(output.contentType).send(output.body);
        }
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Store chat messages
router.post('/:version/chat', (req, res) => {
    const { username, message, timestamp, session, token } = req.body || {};
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!message) {
        error(res, 400, 'Please provide a message (&message={message})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    try {
        const result = req.module.chat('message', {
            username,
            message,
            timestamp,
            session,
            token,
            storage: chatStorage,
        });
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Clear a private chat
router.post('/:version/chat/clear', (req, res) => {
    const { username, session, token } = req.body || {};
    const { version } = req.params;
    if (!since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!token) {
        error(res, 400, 'Please provide a valid token (&token={key}).');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    try {
        res.jsonResponse(req.module.chat('clear', { username, token, session, storage: chatStorage }));
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Display a private chat with a token
router.post('/:version/chat/private', (req, res) => {
    const { username, token } = req.body || {};
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!token) {
        error(res, 400, 'Please provide a valid token (&token={key}).');
        return;
    }
    try {
        const messages = req.module.chat('private', {
            username,
            token,
            storage: chatStorage,
        });
        res.jsonResponse(messages);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Convert between CSV and JSON
router.post('/:version/csv', (req, res) => {
    const body = req.body || {};
    const { action, csv: csvData, json: jsonData, delimiter, headers } = body;
    const { version } = req.params;
    const csvFn = req.module.csv;
    if (!csvFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!action) {
        error(res, 400, 'Please provide an action (?action=parse|format)');
        return;
    }
    try {
        const result = csvFn(action, { csv: csvData, json: jsonData }, {
            delimiter: delimiter,
            headers: headers !== undefined ? Boolean(headers) : undefined,
        });
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Compare two texts with a structured diff
router.post('/:version/diff', (req, res) => {
    const body = req.body || {};
    const { a, b, mode } = body;
    const { version } = req.params;
    const diffFn = req.module.diff;
    if (!diffFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (typeof a !== 'string') {
        error(res, 400, 'Please provide a first text (a={text})');
        return;
    }
    if (typeof b !== 'string') {
        error(res, 400, 'Please provide a second text (b={text})');
        return;
    }
    try {
        const result = diffFn(a, b, mode);
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Generate hash
router.post('/:version/hash', (req, res) => {
    const { text, method, encoding } = req.body || {};
    if (!text) {
        error(res, 400, 'Please provide a text (?text={text})');
        return;
    }
    if (!method) {
        error(res, 400, 'Please provide a valid hash algorithm (&method={algorithm})');
        return;
    }
    try {
        const hashFn = req.module.hash;
        const result = hashFn(text, method, encoding);
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Display a planning from an ICS file
router.post('/:version/hyperplanning', async (req, res) => {
    const { url, detail } = req.body || {};
    if (!url) {
        error(res, 400, 'Please provide a valid ICS file URL (?url={URL})');
        return;
    }
    try {
        const hyperplanning = await req.module.hyperplanning(url, detail);
        res.jsonResponse(hyperplanning);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Decode a JSON Web Token without verifying the signature
router.post('/:version/jwt', (req, res) => {
    const body = req.body || {};
    const { token } = body;
    const { version } = req.params;
    const jwtFn = req.module.jwt;
    if (!jwtFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!token) {
        error(res, 400, 'Please provide a token (?token={token})');
        return;
    }
    try {
        const result = jwtFn(token);
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Compute the Levenshtein distance between two strings
router.post('/:version/levenshtein', (req, res) => {
    const body = req.body || {};
    const { str1, str2 } = body;
    const { version } = req.params;
    if (!since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!str1 || typeof str1 !== 'string') {
        error(res, 400, 'Please provide a first string (str1={string})');
        return;
    }
    if (!str2 || typeof str2 !== 'string') {
        error(res, 400, 'Please provide a second string (str2={string})');
        return;
    }
    try {
        res.jsonResponse(req.module.levenshtein(str1, str2));
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Matrix operations
router.post('/:version/matrix', (req, res) => {
    const body = req.body || {};
    const { operation, matrix: m, matrix2, scalar } = body;
    const { version } = req.params;
    const matrixMod = req.module.matrix;
    if (!matrixMod) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!operation || typeof operation !== 'string' || !Object.hasOwn(matrixMod, operation)) {
        error(res, 400, 'Please provide a valid operation (?operation=add|subtract|multiply|scalar|transpose|determinant|inverse|identity)');
        return;
    }
    try {
        let result;
        switch (operation) {
            case 'add':
            case 'subtract':
            case 'multiply':
                result = matrixMod[operation](m, matrix2);
                break;
            case 'scalar':
                result = matrixMod.scalar(m, scalar);
                break;
            case 'transpose':
            case 'determinant':
            case 'inverse':
                result = matrixMod[operation](m);
                break;
            case 'identity':
                result = matrixMod.identity(scalar);
                break;
            default:
                throw new Error('Unknown operation');
        }
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Generate or verify OTP codes
router.post('/:version/otp', (req, res) => {
    const body = req.body || {};
    const { action, secret, code, algorithm, digits, period, counter, label, issuer } = body;
    const { version } = req.params;
    const otpFn = req.module.otp;
    if (!otpFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!action) {
        error(res, 400, 'Please provide an action (?action=secret|generate|verify)');
        return;
    }
    try {
        const result = otpFn(action, {
            secret: secret,
            code: code,
            algorithm: algorithm,
            digits: digits !== undefined ? Number(digits) : undefined,
            period: period !== undefined ? Number(period) : undefined,
            counter: counter !== undefined ? Number(counter) : undefined,
            label: label,
            issuer: issuer,
        });
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Verify a solved proof-of-work challenge
router.post('/:version/pow', (req, res) => {
    const body = req.body || {};
    const { token, nonce } = body;
    const { version } = req.params;
    const verifyFn = req.module.verifyPow;
    if (!verifyFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!token || typeof token !== 'string') {
        error(res, 400, 'Please provide a token (?token={token})');
        return;
    }
    if (nonce === undefined || nonce === null) {
        error(res, 400, 'Please provide a nonce (&nonce={nonce})');
        return;
    }
    try {
        res.jsonResponse(verifyFn(token, String(nonce), challengeStorage));
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Compute readability scores on a text
router.post('/:version/read', (req, res) => {
    const body = req.body || {};
    const { text, lang } = body;
    const { version } = req.params;
    const readFn = req.module.read;
    if (!readFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!text || typeof text !== 'string') {
        error(res, 400, 'Please provide a text');
        return;
    }
    try {
        const result = readFn(text, lang);
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Symmetric encrypt or decrypt text
router.post('/:version/symmetric', (req, res) => {
    const body = req.body || {};
    const { action, text, key, algorithm } = body;
    const { version } = req.params;
    const symmetricFn = req.module
        .symmetric;
    if (!symmetricFn) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!action) {
        error(res, 400, 'Please provide an action (?action=encrypt|decrypt)');
        return;
    }
    if (!text) {
        error(res, 400, 'Please provide a text (&text={text})');
        return;
    }
    if (!key) {
        error(res, 400, 'Please provide a key (&key={key})');
        return;
    }
    try {
        const result = symmetricFn(action, text, key, algorithm);
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Store tic tac toe games
router.post('/:version/tic-tac-toe', (req, res) => {
    if (since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${req.version}.`);
        return;
    }
    const { username, move, session, game } = req.body || {};
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!move) {
        error(res, 400, 'Please provide a valid move (&move={move})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    if (!game) {
        error(res, 400, 'Please provide a valid game ID (&game={ID})');
        return;
    }
    try {
        const result = req.module.tic_tac_toe('play', {
            username,
            move,
            session,
            game,
            storage: ticTacToeStorage,
        });
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Display a tic tac toe game with a token
router.post('/:version/tic-tac-toe/fetch', (req, res) => {
    const { username, game } = req.body || {};
    const privateGame = (req.body || {}).private;
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    try {
        const result = req.module.tic_tac_toe('fetch', {
            username,
            game,
            private: privateGame,
            storage: ticTacToeStorage,
        });
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Forfeit a tic-tac-toe game
router.post('/:version/tic-tac-toe/forfeit', (req, res) => {
    const { username, session, game } = req.body || {};
    const { version } = req.params;
    if (!since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    if (!game) {
        error(res, 400, 'Please provide a game ID (&game={ID})');
        return;
    }
    try {
        res.jsonResponse(req.module.tic_tac_toe('forfeit', { username, session, game, storage: ticTacToeStorage }));
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// List public tic tac toe games
router.post('/:version/tic-tac-toe/list', (req, res) => {
    try {
        const result = req.module.tic_tac_toe('list', {
            storage: ticTacToeStorage,
        });
        res.jsonResponse(result);
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Play a tic-tac-toe move
router.post('/:version/tic-tac-toe/play', (req, res) => {
    const { username, move, session, game } = req.body || {};
    const { version } = req.params;
    if (!since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${version}.`);
        return;
    }
    if (!username) {
        error(res, 400, 'Please provide a username (?username={username})');
        return;
    }
    if (!move) {
        error(res, 400, 'Please provide a valid move (&move={move})');
        return;
    }
    if (!session) {
        error(res, 400, 'Please provide a valid session ID (&session={ID})');
        return;
    }
    if (!game) {
        error(res, 400, 'Please provide a game ID (&game={ID})');
        return;
    }
    try {
        res.jsonResponse(req.module.tic_tac_toe('play', { username, move, session, game, storage: ticTacToeStorage }));
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
// Generate Token
router.post('/:version/token', (req, res) => {
    const body = req.body || {};
    const len = parseInt(String(body.len ?? 24), 10);
    const type = body.type ? String(body.type).toLowerCase() : 'alpha';
    if (isNaN(len) || len < 0) {
        error(res, 400, 'Invalid number.');
        return;
    }
    if (len > MAX_TOKEN_LENGTH) {
        error(res, 400, 'Length cannot exceed 4096.');
        return;
    }
    if (len < MIN_TOKEN_LENGTH) {
        error(res, 400, 'Length cannot be less than 12.');
        return;
    }
    try {
        const token = req.module.token(len, type);
        res.jsonResponse({ token });
    }
    catch (err) {
        error(res, 400, err.message);
    }
});
export default router;
//# sourceMappingURL=post.js.map
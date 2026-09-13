import { Router } from 'express';
import { ticTacToeStorage } from '../storage/index.js';
import { since } from '../utils/helpers.js';
import { error } from '../utils/response.js';
const router = Router();
// Play a tic-tac-toe move
router.patch('/:version/tic-tac-toe/:game', (req, res) => {
    if (parseInt(req.version.slice(1)) < 4) {
        error(res, 405, 'PATCH is only supported in v4+.');
        return;
    }
    if (since(req.version, 6)) {
        error(res, 404, `Endpoint not available in ${req.version}.`);
        return;
    }
    const game = req.params.game;
    const { username, move, session } = req.body || {};
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
export default router;
//# sourceMappingURL=patch.js.map
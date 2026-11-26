/* Deployment settings for the static build.
 *
 * backend: origin of the Python server that hosts online rooms (and, when
 * reachable, the game API). Leave empty to use the same origin as the page,
 * which is right when the page is served by `python run.py`.
 * On a static host (e.g. the Hugging Face Space) point it at your deployed
 * server, for example "https://tic-tac-pro.onrender.com".
 */
window.TTP_CONFIG = {
  backend: "",
};

window.App = window.App || {};
window.App.viewSetup = {
    init: function (ctx) { this.ctx = ctx; },
    render: function () {
        document.getElementById('ansicht-setup').textContent = 'Einrichtung folgt in Task 7';
    }
};

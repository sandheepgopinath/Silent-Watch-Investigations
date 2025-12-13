const canvas = document.getElementById('rain-canvas');
const ctx = canvas.getContext('2d');

let width, height;
let drops = [];
let weatherType = 'rain'; // 'rain' or 'leaves'

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

class Drop {
    constructor() {
        this.reset(true);
    }

    reset(initial = false) {
        this.x = Math.random() * width;
        this.y = initial ? Math.random() * height : -20;

        if (weatherType === 'rain') {
            this.speed = Math.random() * 2 + 1; // Faster for rain
            this.len = Math.random() * 20 + 10;
            this.color = Math.random() > 0.5 ? '#00e5ff' : '#9d00ff'; // Cyan/Purple
            this.opacity = Math.random() * 0.5 + 0.1;
            this.vx = 0;
            this.size = 1; // Line width
        } else {
            // Leaves
            this.speed = Math.random() * 1 + 0.5; // Slower for leaves
            this.len = Math.random() * 5 + 5; // Smaller "leaf" size
            // Brown/Autumn colors
            const colors = ['#8B4513', '#A0522D', '#CD853F', '#D2691E'];
            this.color = colors[Math.floor(Math.random() * colors.length)];
            this.opacity = Math.random() * 0.6 + 0.2;
            this.vx = Math.random() * 1 - 0.5; // Horizontal drift
            this.size = Math.random() * 3 + 2; // Thicker for leaves
            this.angle = Math.random() * Math.PI * 2;
            this.spin = (Math.random() - 0.5) * 0.05;
        }
    }

    update() {
        this.y += this.speed;
        this.x += this.vx;

        if (weatherType === 'leaves') {
            this.angle += this.spin;
            this.x += Math.sin(this.angle) * 0.5; // Swaying effect
        }

        if (this.y > height) {
            this.reset();
        }
    }

    draw() {
        ctx.beginPath();
        if (weatherType === 'rain') {
            const grad = ctx.createLinearGradient(this.x, this.y, this.x, this.y + this.len);
            grad.addColorStop(0, `rgba(0,0,0,0)`);
            grad.addColorStop(1, this.color);
            ctx.strokeStyle = grad;
            ctx.globalAlpha = this.opacity;
            ctx.lineWidth = 1;
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x, this.y + this.len);
            ctx.stroke();
        } else {
            // Draw Leaf (simple circle/oval for now)
            ctx.fillStyle = this.color;
            ctx.globalAlpha = this.opacity;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.fillRect(0, 0, this.size, this.size * 1.5); // Simple leaf shape
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }
}

function init() {
    resize();
    const count = Math.floor(width / (weatherType === 'rain' ? 2 : 4)); // Less leaves than rain
    drops = [];
    for (let i = 0; i < count; i++) {
        drops.push(new Drop());
    }
}

function animate() {
    ctx.clearRect(0, 0, width, height);
    if (weatherType !== 'clear') {
        drops.forEach(drop => {
            drop.update();
            drop.draw();
        });
    }
    requestAnimationFrame(animate);
}

// Global function to change weather
window.setWeather = function (type) {
    if (type !== weatherType) {
        weatherType = type;
        if (type === 'clear') {
            drops = [];
            ctx.clearRect(0, 0, width, height);
        } else {
            init(); // Re-init drops with new style
        }
    }
};

window.addEventListener('resize', () => {
    resize();
    init();
});

document.addEventListener('DOMContentLoaded', () => {
    if (canvas) {
        init();
        animate();
    }
});

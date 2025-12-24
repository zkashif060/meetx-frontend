import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VideoRoom } from './components/video-room/video-room';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, VideoRoom],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('meetx');
}

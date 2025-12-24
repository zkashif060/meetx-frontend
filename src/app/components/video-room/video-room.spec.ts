import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VideoRoom } from './video-room';

describe('VideoRoom', () => {
  let component: VideoRoom;
  let fixture: ComponentFixture<VideoRoom>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VideoRoom]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VideoRoom);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

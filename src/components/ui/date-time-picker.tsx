"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Clock face component with clickable numbers
type ClockView = "hours" | "minutes" | "seconds";

interface ClockFaceProps {
  hours: number; // 0-23
  minutes: number; // 0-59
  seconds: number; // 0-59
  view: ClockView;
  onChange: (value: number) => void;
  onViewChange: (view: ClockView) => void;
}

function ClockFace({ hours, minutes, seconds, view, onChange, onViewChange }: ClockFaceProps) {
  const size = 140;
  const center = size / 2;
  const outerRadius = size / 2 - 14;

  // Calculate hand endpoints for all three hands
  const getHandEnd = (value: number, max: number, length: number) => {
    const angle = ((value / max) * 360 - 90) * (Math.PI / 180);
    return {
      x: center + Math.cos(angle) * length,
      y: center + Math.sin(angle) * length,
    };
  };

  const hourHandEnd = getHandEnd(hours % 12 + minutes / 60, 12, outerRadius * 0.5);
  const minuteHandEnd = getHandEnd(minutes + seconds / 60, 60, outerRadius * 0.7);
  const secondHandEnd = getHandEnd(seconds, 60, outerRadius * 0.85);

  // Generate numbers based on view
  const getNumbers = () => {
    if (view === "hours") {
      return [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    }
    // Minutes and seconds: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55
    return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  };

  const numbers = getNumbers();

  // Calculate position for a number on the clock face
  const getPosition = (index: number, radius: number) => {
    const angle = (index * 30 - 90) * (Math.PI / 180);
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  };

  // Get current value for the active view
  const getCurrentValue = () => {
    if (view === "hours") return hours % 12 || 12;
    if (view === "minutes") return minutes;
    return seconds;
  };

  // Handle click on clock face
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - center;
    const y = e.clientY - rect.top - center;

    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;

    if (view === "hours") {
      let hour = Math.round(angle / 30) % 12;
      if (hour === 0) hour = 12;
      onChange(hour);
      setTimeout(() => onViewChange("minutes"), 200);
    } else {
      const value = Math.round(angle / 6) % 60;
      onChange(value);
      if (view === "minutes") {
        setTimeout(() => onViewChange("seconds"), 200);
      } else {
        // Seconds -> cycle back to hours
        setTimeout(() => onViewChange("hours"), 200);
      }
    }
  };

  // Check if a number is selected
  const isSelected = (num: number) => {
    const current = getCurrentValue();
    if (view === "hours") {
      return current === num;
    }
    return current === num;
  };

  return (
    <svg
      width={size}
      height={size}
      className="cursor-pointer"
      onClick={handleClick}
    >
      {/* Clock face background */}
      <circle
        cx={center}
        cy={center}
        r={outerRadius + 10}
        className="fill-muted/50"
      />

      {/* Hour hand (thick, violet) */}
      <line
        x1={center}
        y1={center}
        x2={hourHandEnd.x}
        y2={hourHandEnd.y}
        className={cn("stroke-primary", view === "hours" ? "opacity-100" : "opacity-40")}
        strokeWidth={3}
        strokeLinecap="round"
      />

      {/* Minute hand (medium, white) */}
      <line
        x1={center}
        y1={center}
        x2={minuteHandEnd.x}
        y2={minuteHandEnd.y}
        className={cn("stroke-foreground", view === "minutes" ? "opacity-100" : "opacity-40")}
        strokeWidth={2}
        strokeLinecap="round"
      />

      {/* Second hand (thin, red) */}
      <line
        x1={center}
        y1={center}
        x2={secondHandEnd.x}
        y2={secondHandEnd.y}
        className={cn("stroke-red-400", view === "seconds" ? "opacity-100" : "opacity-40")}
        strokeWidth={1}
        strokeLinecap="round"
      />

      {/* Center dot */}
      <circle cx={center} cy={center} r={4} className="fill-primary" />

      {/* Numbers around the clock */}
      {numbers.map((num, i) => {
        const pos = getPosition(i, outerRadius - 4);
        const selected = isSelected(num);
        return (
          <g key={num}>
            {selected && (
              <circle cx={pos.x} cy={pos.y} r={12} className="fill-primary" />
            )}
            <text
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className={cn(
                "text-[10px] font-medium pointer-events-none",
                selected ? "fill-primary-foreground" : "fill-muted-foreground"
              )}
            >
              {view === "hours" ? num : num.toString().padStart(2, "0")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface DateTimePickerProps {
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  minDate?: Date;
  className?: string;
  placeholder?: string;
}

export function DateTimePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick date and time",
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [clockView, setClockView] = React.useState<ClockView>("hours");
  const [timeInput, setTimeInput] = React.useState("");

  // Sync time input with date
  React.useEffect(() => {
    if (date) {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const seconds = date.getSeconds();
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      setTimeInput(
        `${displayHours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")} ${ampm}`
      );
    } else {
      setTimeInput("");
    }
  }, [date]);

  // Reset clock view when opening
  React.useEffect(() => {
    if (isOpen) {
      setClockView("hours");
    }
  }, [isOpen]);

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      onDateChange(undefined);
      return;
    }

    // Preserve existing time or use current time
    const currentHour = date?.getHours() ?? new Date().getHours();
    const currentMinute = date?.getMinutes() ?? 0;
    const currentSecond = date?.getSeconds() ?? 0;

    const newDate = new Date(selectedDate);
    newDate.setHours(currentHour);
    newDate.setMinutes(currentMinute);
    newDate.setSeconds(currentSecond);
    newDate.setMilliseconds(0);

    onDateChange(newDate);
  };

  // Parse and apply time input
  const parseTimeInput = (input: string) => {
    const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
    const match = input.trim().match(timeRegex);
    if (!match) return;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    const ampm = match[4]?.toUpperCase();

    if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return;

    if (ampm) {
      if (hours < 1 || hours > 12) return;
      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
    } else {
      if (hours < 0 || hours > 23) return;
    }

    const baseDate = date || new Date();
    const newDate = new Date(baseDate);
    newDate.setHours(hours);
    newDate.setMinutes(minutes);
    newDate.setSeconds(seconds);
    newDate.setMilliseconds(0);
    onDateChange(newDate);
  };

  const currentHours = date?.getHours() ?? 0;
  const currentMinutes = date?.getMinutes() ?? 0;
  const currentSeconds = date?.getSeconds() ?? 0;
  const isAM = currentHours < 12;

  // Handle clock value change
  const handleClockChange = (value: number) => {
    const baseDate = date || new Date();
    const newDate = new Date(baseDate);

    if (clockView === "hours") {
      // Preserve AM/PM when changing hour
      if (isAM) {
        newDate.setHours(value === 12 ? 0 : value);
      } else {
        newDate.setHours(value === 12 ? 12 : value + 12);
      }
    } else if (clockView === "minutes") {
      newDate.setMinutes(value);
    } else {
      newDate.setSeconds(value);
    }

    newDate.setMilliseconds(0);
    onDateChange(newDate);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-8 text-xs",
            "bg-card/50 border-border hover:bg-card hover:border-border",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-primary" />
          {date ? (
            format(date, "MMM d, yyyy 'at' h:mm:ss a")
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Calendar - Left side */}
          <div className="border-r border-border">
            <Calendar
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
              disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
              initialFocus
            />
          </div>

          {/* Time Picker - Right side */}
          <div className="p-2 flex flex-col">
            {/* Time input */}
            <Input
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              onBlur={() => parseTimeInput(timeInput)}
              onKeyDown={(e) => e.key === "Enter" && parseTimeInput(timeInput)}
              placeholder="12:00:00 PM"
              className="h-7 text-xs font-mono bg-card/50 border-border text-center mb-2"
            />

            {/* View tabs */}
            <div className="flex gap-1 mb-2">
              {(["hours", "minutes", "seconds"] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setClockView(view)}
                  className={cn(
                    "flex-1 h-6 text-[9px] rounded transition-colors",
                    clockView === view
                      ? "bg-primary text-primary-foreground"
                      : "bg-card/50 text-muted-foreground hover:bg-primary/20"
                  )}
                >
                  {view === "hours" ? "HR" : view === "minutes" ? "MIN" : "SEC"}
                </button>
              ))}
            </div>

            {/* Clock face */}
            <div className="flex justify-center">
              <ClockFace
                hours={currentHours}
                minutes={currentMinutes}
                seconds={currentSeconds}
                view={clockView}
                onChange={handleClockChange}
                onViewChange={setClockView}
              />
            </div>

            {/* AM/PM toggle */}
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => {
                  if (!date) return;
                  const newDate = new Date(date);
                  const hours = newDate.getHours();
                  if (hours >= 12) newDate.setHours(hours - 12);
                  onDateChange(newDate);
                }}
                className={cn(
                  "flex-1 h-6 text-[10px] rounded transition-colors",
                  isAM
                    ? "bg-primary text-primary-foreground"
                    : "bg-card/50 text-muted-foreground hover:bg-primary/20"
                )}
              >
                AM
              </button>
              <button
                onClick={() => {
                  if (!date) return;
                  const newDate = new Date(date);
                  const hours = newDate.getHours();
                  if (hours < 12) newDate.setHours(hours + 12);
                  onDateChange(newDate);
                }}
                className={cn(
                  "flex-1 h-6 text-[10px] rounded transition-colors",
                  !isAM
                    ? "bg-primary text-primary-foreground"
                    : "bg-card/50 text-muted-foreground hover:bg-primary/20"
                )}
              >
                PM
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Separate components for just date or just time if needed
export function DatePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick a date",
}: Omit<DateTimePickerProps, "placeholder"> & { placeholder?: string }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-8 text-xs",
            "bg-card/50 border-border hover:bg-card hover:border-border",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-primary" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onDateChange}
          disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
          initialFocus
          classNames={{
            months: "flex flex-col",
            month: "space-y-2",
            caption: "flex justify-center pt-0.5 relative items-center",
            caption_label: "text-xs font-medium text-foreground",
            nav: "space-x-1 flex items-center",
            nav_button: cn(
              "h-6 w-6 bg-transparent p-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
            ),
            nav_button_previous: "absolute left-0.5",
            nav_button_next: "absolute right-0.5",
            table: "w-full border-collapse space-y-0.5",
            head_row: "flex",
            head_cell: "text-muted-foreground rounded-md w-7 font-normal text-[10px]",
            row: "flex w-full mt-0.5",
            cell: cn(
              "relative p-0 text-center text-xs focus-within:relative focus-within:z-20",
              "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            ),
            day: cn(
              "h-7 w-7 p-0 font-normal text-xs rounded-md transition-colors",
              "text-muted-foreground hover:bg-primary/20 hover:text-foreground",
              "focus:bg-primary/20 focus:text-foreground focus:outline-none"
            ),
            day_selected: "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground focus:bg-primary/90",
            day_today: "bg-accent text-foreground",
            day_outside: "text-muted-foreground/50 opacity-50",
            day_disabled: "text-muted-foreground/50 opacity-50 cursor-not-allowed",
            day_hidden: "invisible",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface TimePickerProps {
  time: { hour: number; minute: number; second?: number } | undefined;
  onTimeChange: (time: { hour: number; minute: number; second: number }) => void;
  className?: string;
}

export function TimePicker({
  time,
  onTimeChange,
  className,
}: TimePickerProps) {
  const [timeInput, setTimeInput] = React.useState("");

  React.useEffect(() => {
    if (time) {
      const hours = time.hour;
      const minutes = time.minute;
      const seconds = time.second ?? 0;
      const ampm = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      setTimeInput(
        `${displayHours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")} ${ampm}`
      );
    }
  }, [time]);

  const parseAndUpdateTime = (input: string) => {
    const timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
    const match = input.trim().match(timeRegex);

    if (!match) return;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    const ampm = match[4]?.toUpperCase();

    if (minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return;

    if (ampm) {
      if (hours < 1 || hours > 12) return;
      if (ampm === "PM" && hours !== 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
    } else {
      if (hours < 0 || hours > 23) return;
    }

    onTimeChange({ hour: hours, minute: minutes, second: seconds });
  };

  const isAM = (time?.hour ?? 0) < 12;

  const toggleAmPm = () => {
    if (!time) return;
    const hours = time.hour;
    onTimeChange({
      hour: hours >= 12 ? hours - 12 : hours + 12,
      minute: time.minute,
      second: time.second ?? 0,
    });
  };

  const adjustTime = (field: "hour" | "minute" | "second", delta: number) => {
    const current = time ?? { hour: 0, minute: 0, second: 0 };
    let { hour, minute, second } = current;
    second = second ?? 0;

    if (field === "hour") {
      hour = (hour + delta + 24) % 24;
    } else if (field === "minute") {
      minute = (minute + delta + 60) % 60;
    } else {
      second = (second + delta + 60) % 60;
    }

    onTimeChange({ hour, minute, second });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3 text-primary" />
        <span>Time</span>
      </div>

      <Input
        value={timeInput}
        onChange={(e) => setTimeInput(e.target.value)}
        onBlur={() => parseAndUpdateTime(timeInput)}
        onKeyDown={(e) => e.key === "Enter" && parseAndUpdateTime(timeInput)}
        placeholder="12:00:00 PM"
        className="h-7 text-xs font-mono bg-card/50 border-border text-center"
      />

      <div className="grid grid-cols-3 gap-1">
        {(["hour", "minute", "second"] as const).map((field) => (
          <div key={field} className="flex flex-col items-center gap-0.5">
            <button
              onClick={() => adjustTime(field, 1)}
              className="w-full h-5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            >
              ▲
            </button>
            <span className="text-[10px] text-muted-foreground">
              {field === "hour" ? "hr" : field === "minute" ? "min" : "sec"}
            </span>
            <button
              onClick={() => adjustTime(field, -1)}
              className="w-full h-5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            >
              ▼
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-1">
        <button
          onClick={toggleAmPm}
          className={cn(
            "flex-1 h-6 text-[10px] rounded transition-colors",
            isAM
              ? "bg-primary text-primary-foreground"
              : "bg-card/50 text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
        >
          AM
        </button>
        <button
          onClick={toggleAmPm}
          className={cn(
            "flex-1 h-6 text-[10px] rounded transition-colors",
            !isAM
              ? "bg-primary text-primary-foreground"
              : "bg-card/50 text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
        >
          PM
        </button>
      </div>
    </div>
  );
}
